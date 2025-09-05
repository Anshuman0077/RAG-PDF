// server.js (Completely Fixed Backend)
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import { Queue } from "bullmq";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Store collection names for each uploaded PDF
const pdfCollections = new Map();

// Queue
const queue = new Queue("file-upload-queue", {
  connection: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage: storage });

// Generate unique ID using crypto module
const generatePdfId = () => {
  return crypto.randomBytes(16).toString('hex');
};

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

app.get("/", (req, res) => {
  return res.json({ status: "All Good" });
});

// Get list of uploaded PDFs
app.get("/pdfs", (req, res) => {
  const pdfList = Array.from(pdfCollections.entries()).map(([id, data]) => ({
    id,
    filename: data.filename,
    uploadedAt: data.uploadedAt
  }));
  return res.json(pdfList);
});

// Queue post controller and routes
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Generate a unique ID for this PDF
    const pdfId = generatePdfId();
    
    await queue.add("file-upload", {
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
      pdfId: pdfId // Pass the unique ID to the worker
    });
    
    // Store the collection name mapping
    pdfCollections.set(pdfId, {
      filename: req.file.originalname,
      uploadedAt: new Date().toISOString()
    });
    
    return res.json({ 
      message: "File uploaded successfully", 
      file: req.file,
      pdfId: pdfId,
      status: "Processing started"
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Function to extract page numbers from content
function extractPageNumbers(content) {
  const pageRegex = /\[Page (\d+)\]/g;
  const matches = [];
  let match;
  
  while ((match = pageRegex.exec(content)) !== null) {
    matches.push(parseInt(match[1]));
  }
  
  // Remove duplicates and sort
  return [...new Set(matches)].sort((a, b) => a - b);
}

// Function to clean context by removing page references and other noise
function cleanContext(content) {
  return content
    .replace(/\[Page \d+\]/g, '')  // Remove page references
    .replace(/\.{10,}/g, '')       // Remove sequences of dots
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .replace(/undefined/g, '')     // Remove undefined text
    .replace(/[^\w\s.,!?;:'"-]/g, '') // Remove special characters but keep punctuation
    .trim();
}

// Function to filter and rank relevant content
function filterRelevantContent(content, query) {
  const sentences = content.split(/[.!?]/).filter(s => s.trim().length > 10);
  const queryKeywords = query.toLowerCase().split(/\s+/);
  
  // Score sentences based on keyword matches
  const scoredSentences = sentences.map(sentence => {
    const lowerSentence = sentence.toLowerCase();
    let score = 0;
    
    // Basic keyword matching
    queryKeywords.forEach(keyword => {
      if (lowerSentence.includes(keyword)) {
        score += 3;
      }
    });
    
    // Bonus for exact phrase match
    if (lowerSentence.includes(query.toLowerCase())) {
      score += 10;
    }
    
    // Bonus for sentence that seems to define the concept
    if (lowerSentence.startsWith(query.toLowerCase() + " is") || 
        lowerSentence.startsWith(query.toLowerCase() + " are") ||
        lowerSentence.includes("is " + query.toLowerCase()) ||
        lowerSentence.includes("are " + query.toLowerCase())) {
      score += 15;
    }
    
    return { sentence, score };
  });
  
  // Filter out low-scoring sentences and sort by score
  const relevantSentences = scoredSentences
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.sentence);
  
  // Return the top 5 most relevant sentences
  return relevantSentences.slice(0, 5).join(". ") + ".";
}

// Function to generate a natural, human-like answer using Gemini
async function generateNaturalAnswer(query, context, pageReferences, depth = "normal") {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("GOOGLE_API_KEY is not set");
    }

    const model = genAI.getGenerativeModel({ 
      model: "gemini-pro",
      generationConfig: {
        temperature: depth === "deep" ? 0.3 : 0.1,
        topK: depth === "deep" ? 40 : 20,
        topP: depth === "deep" ? 0.95 : 0.9,
        maxOutputTokens: depth === "deep" ? 2048 : 1024,
      },
    });
    
    // Determine depth instruction
    let depthInstruction = "";
    if (depth === "deep") {
      depthInstruction = "Provide a comprehensive, in-depth explanation with detailed examples and thorough context.";
    } else if (depth === "deeper") {
      depthInstruction = "Provide an extremely detailed, exhaustive explanation covering all aspects, with multiple examples and practical applications.";
    } else {
      depthInstruction = "Provide a clear, direct answer that addresses the specific question.";
    }
    
    // Create page reference text
    const pageRefText = pageReferences.length > 0 
      ? `This information can be found on pages ${pageReferences.join(', ')}.` 
      : "";
    
    const prompt = `
      You are a helpful assistant that provides accurate answers based on document content.

      USER QUESTION: "${query}"

      DOCUMENT CONTENT:
      ${context}

      INSTRUCTIONS:
      1. Answer the user's question in a natural, conversational tone
      2. Use ONLY the information from the provided document content
      3. ${depthInstruction}
      4. If the document doesn't contain the answer, say: "I couldn't find specific information about this in the document. Please try asking about a different topic or rephrasing your question."
      5. Format your response as a clear, well-structured answer
      6. Do not mention that you're "based on the document" - just provide the answer directly
      7. At the end, mention the page references like this: "${pageRefText}"

      IMPORTANT: 
      - Do not just copy text from the document. Synthesize the information into a coherent answer.
      - If the document content doesn't directly answer the question, admit it rather than making up an answer.

      Please provide your answer:
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Ensure the response includes page references if available
    let finalResponse = response.text();
    
    // Check if the response is a non-answer and improve it
    if (finalResponse.includes("I couldn't find") || 
        finalResponse.includes("the document doesn't contain") ||
        finalResponse.length < 50) {
      
      // Try a different approach with a more specific prompt
      const retryPrompt = `
        The user asked: "${query}"
        
        Here is the relevant content from the document:
        ${context}
        
        Even if the information is not perfect, try to provide the most helpful answer possible based on what's available.
        If you can infer something from the context, do so but mention it's an inference.
        If there's truly nothing relevant, say: "I couldn't find specific information about this in the document. 
        The document seems to focus on other topics. Please try asking about something else."
      `;
      
      const retryResult = await model.generateContent(retryPrompt);
      const retryResponse = await retryResult.response;
      finalResponse = retryResponse.text();
    }
    
    // Add page references if they're not already included
    if (pageRefText && !finalResponse.includes(pageRefText) && !finalResponse.includes("I couldn't find")) {
      finalResponse += ` ${pageRefText}`;
    }
    
    return finalResponse;
  } catch (error) {
    console.error("Error generating response with Gemini:", error);
    // Fallback to a better response
    if (pageReferences.length > 0) {
      return `I found some information about "${query}" in the document. This information can be found on pages ${pageReferences.join(', ')}.`;
    } else {
      return `I couldn't find specific information about "${query}" in the document. Please try asking about a different topic.`;
    }
  }
}

app.post("/chat", async (req, res) => {
  try {
    const { query, pdfId, depth } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    
    if (!pdfId || !pdfCollections.has(pdfId)) {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    // Handle greetings and small talk
    if (isSmallTalk(query)) {
      return res.json({
        query,
        results: getSmallTalkResponse(query),
        pageReferences: [],
        count: 0
      });
    }

    // Initialize embeddings
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GOOGLE_API_KEY,
      modelName: "embedding-001",
    });

    // Connect to the specific PDF's collection
    const vectorStore = new QdrantVectorStore(embeddings, {
      url: process.env.QDRANT_URL || "http://localhost:6333",
      collectionName: pdfId,
    });

    // Create a retriever to get relevant context
    const retriever = vectorStore.asRetriever({
      k: 10, // Get more chunks to have better context
      searchType: "similarity",
      searchKwargs: {
        scoreThreshold: 0.3, // Lower threshold to get more context
      }
    });

    // Get similar documents
    const results = await retriever.invoke(query);
    
    if (results.length === 0) {
      return res.json({
        query,
        results: `I couldn't find information about "${query}" in this document. Please try asking about something else or check if you've uploaded the right document.`,
        pageReferences: [],
        count: 0
      });
    }

    // Extract content with page references
    const relevantContent = results.map(doc => doc.pageContent).join(" ");
    
    // Extract page numbers from the results
    const pageReferences = extractPageNumbers(relevantContent);
    
    // Clean the context to remove noise
    const cleanedContext = cleanContext(relevantContent);
    
    // Filter for the most relevant content
    const filteredContext = filterRelevantContent(cleanedContext, query);

    // Generate a natural answer using Gemini with depth parameter
    let aiResponse = await generateNaturalAnswer(query, filteredContext, pageReferences, depth || "normal");
    
    return res.json({
      query,
      results: aiResponse,
      pageReferences,
      count: results.length
    });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
});

// Function to handle small talk
function isSmallTalk(query) {
  const smallTalkPatterns = [
    /^hi$|^hello$|^hey$|^greetings$/i,
    /^how are you$/i,
    /^thanks|thank you|thx/i,
    /^good morning|good afternoon|good evening/i,
    /^what's up|sup/i,
    /^who are you$/i
  ];
  
  return smallTalkPatterns.some(pattern => pattern.test(query.trim()));
}

// Function to generate responses for small talk
function getSmallTalkResponse(query) {
  const lowerQuery = query.toLowerCase().trim();
  
  if (/^hi$|^hello$|^hey$|^greetings$/.test(lowerQuery)) {
    return "Hello! I'm here to help you understand your PDF documents. What would you like to know about your document?";
  }
  
  if (/^how are you$/.test(lowerQuery)) {
    return "I'm doing well, thank you! Ready to help you explore your document. What would you like to know?";
  }
  
  if (/^thanks|thank you|thx/.test(lowerQuery)) {
    return "You're welcome! Is there anything else you'd like to know about your document?";
  }
  
  if (/^good morning|good afternoon|good evening/.test(lowerQuery)) {
    return `${query}! How can I help you with your document today?`;
  }
  
  if (/^what's up|sup/.test(lowerQuery)) {
    return "Just ready to help you understand your documents! What would you like to know?";
  }
  
  if (/^who are you$/.test(lowerQuery)) {
    return "I'm your PDF assistant, here to help you understand and explore the content of your documents. You can ask me questions about anything in your PDF!";
  }
  
  return "How can I help you with your document today?";
}

app.listen(8000, () =>
  console.log(`✅ Server is running on PORT: 8000`)
);
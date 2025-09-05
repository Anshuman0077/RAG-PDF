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
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

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

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  }
});

// Generate unique ID using crypto module
const generatePdfId = () => {
  return crypto.randomBytes(16).toString('hex');
};

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

// Initialize Qdrant client
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333",
});

// Enhanced text extraction using PDFLoader only
async function extractTextFromPDF(filePath) {
  try {
    // Use PDFLoader from LangChain for reliable text extraction
    const loader = new PDFLoader(filePath, {
      parsedItemSeparator: " ",
    });
    
    const docs = await loader.load();
    const text = docs.map(doc => doc.pageContent).join(" ");
    
    return text;
  } catch (error) {
    console.error("Text extraction error:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

// Enhanced text cleaning and structuring
function cleanAndStructureText(text, pdfType = 'general') {
  // Remove excessive whitespace
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  return { text: cleaned, type: pdfType };
}

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Check Redis connection
    const redis = new Redis(redisConnection);
    await redis.ping();
    
    // Check Qdrant connection
    const qdrantResponse = await fetch(`${process.env.QDRANT_URL || "http://localhost:6333"}/collections`);
    if (!qdrantResponse.ok) {
      throw new Error("Qdrant connection failed");
    }
    
    return res.json({ 
      status: "healthy",
      redis: "connected",
      qdrant: "connected",
      googleAI: process.env.GOOGLE_API_KEY ? "configured" : "not configured"
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(500).json({ 
      status: "unhealthy",
      error: error.message 
    });
  }
});

app.get("/", (req, res) => {
  return res.json({ status: "All Good" });
});

// Get list of uploaded PDFs
app.get("/pdfs", (req, res) => {
  const pdfList = Array.from(pdfCollections.entries()).map(([id, data]) => ({
    id,
    filename: data.filename,
    uploadedAt: data.uploadedAt,
    type: data.type || 'general'
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
    
    // Extract and analyze text to determine PDF type
    const extractedText = await extractTextFromPDF(req.file.path);
    const { text: cleanedText, type: pdfType } = cleanAndStructureText(extractedText);
    
    // Store the text temporarily for processing
    const tempTextPath = `uploads/${pdfId}_temp.txt`;
    fs.writeFileSync(tempTextPath, cleanedText);
    
    await queue.add("file-upload", {
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
      textPath: tempTextPath,
      pdfId: pdfId,
      pdfType: pdfType
    });
    
    // Store the collection name mapping
    pdfCollections.set(pdfId, {
      filename: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      type: pdfType
    });
    
    return res.json({ 
      message: "File uploaded successfully", 
      file: req.file,
      pdfId: pdfId,
      pdfType: pdfType,
      status: "Processing started"
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Function to generate a high-quality answer using Gemini
async function generateEnhancedAnswer(query, context, pageReferences, pdfType, depth = "normal") {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("GOOGLE_API_KEY is not set");
    }

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: depth === "deep" ? 0.3 : 0.1,
        topK: depth === "deep" ? 40 : 20,
        topP: depth === "deep" ? 0.95 : 0.9,
        maxOutputTokens: depth === "deep" ? 4096 : 2048,
      },
    });
    
    // Determine depth instruction
    let depthInstruction = "";
    if (depth === "step-by-step") {
      depthInstruction = "Provide a detailed, step-by-step explanation. Break down complex concepts into manageable steps with clear transitions between them.";
    } else if (depth === "deep") {
      depthInstruction = "Provide a comprehensive, in-depth explanation with detailed examples, analogies, and thorough context.";
    } else if (depth === "deeper") {
      depthInstruction = "Provide an extremely detailed, exhaustive explanation covering all aspects, with multiple examples, practical applications, and connections to related concepts.";
    } else if (depth === "simple") {
      depthInstruction = "Provide a simple, easy-to-understand explanation. Avoid technical jargon and use everyday language with relatable examples.";
    } else {
      depthInstruction = "Provide a clear, direct answer that addresses the specific question.";
    }
    
    // Adjust instruction based on PDF type
    let typeInstruction = "";
    if (pdfType === "qa") {
      typeInstruction = "This document appears to be in a question-answer format. When appropriate, structure your response in a similar Q&A style or clearly address the questions posed in the document.";
    }
    
    const pageRefText = pageReferences.length > 0 
      ? `This information can be found on pages ${pageReferences.join(', ')}.` 
      : "";
    
    const prompt = `
      You are an expert educational assistant that provides exceptional answers based on document content.

      DOCUMENT TYPE: ${pdfType}
      USER QUESTION: "${query}"
      REQUESTED DEPTH: ${depth}

      DOCUMENT CONTEXT:
      ${context}

      INSTRUCTIONS:
      1. ${depthInstruction}
      2. ${typeInstruction}
      3. Answer the question based ONLY on the provided document content
      4. Do not make up information not found in the document
      5. If the document doesn't contain the answer, say so politely but helpfully
      6. Write in a natural, engaging, and conversational tone
      7. Format your response appropriately - use headings, bullet points, or numbered steps when helpful
      8. Include the page reference: "${pageRefText}"

      IMPORTANT: 
      - If explaining a process or concept, break it down into logical steps
      - Use analogies and examples to make complex ideas accessible
      - For mathematical or technical content, show your work or reasoning process
      - Adapt your explanation style to match the document's content and structure

      Please provide your enhanced answer:
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Ensure page references are included
    let finalResponse = response.text();
    if (pageRefText && !finalResponse.includes(pageRefText)) {
      finalResponse += `\n\n${pageRefText}`;
    }
    
    return finalResponse;
  } catch (error) {
    console.error("Error generating response with Gemini:", error);
    // Fallback to a simple response
    return `Based on the document, I found relevant information about "${query}". ${pageReferences.length > 0 ? `This information can be found on pages ${pageReferences.join(', ')}.` : ''}`;
  }
}

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

// Function to filter and rank relevant content
function filterRelevantContent(content, query, pdfType) {
  const sentences = content.split(/[.!?]/).filter(s => s.trim().length > 10);
  const queryKeywords = query.toLowerCase().split(/\s+/);
  
  // Score sentences based on keyword matches and relevance
  const scoredSentences = sentences.map(sentence => {
    const lowerSentence = sentence.toLowerCase();
    let score = 0;
    
    // Basic keyword matching
    queryKeywords.forEach(keyword => {
      if (keyword.length > 3 && lowerSentence.includes(keyword)) {
        score += 3;
      }
    });
    
    // Bonus for exact phrase match
    if (lowerSentence.includes(query.toLowerCase())) {
      score += 10;
    }
    
    // Bonus for definition sentences
    if ((lowerSentence.startsWith(query.toLowerCase() + " is") || 
        lowerSentence.startsWith(query.toLowerCase() + " are") ||
        lowerSentence.includes("is " + query.toLowerCase()) ||
        lowerSentence.includes("are " + query.toLowerCase()) ||
        lowerSentence.includes("defined as") ||
        lowerSentence.includes("refers to"))) {
      score += 15;
    }
    
    // For Q&A documents, prioritize question-answer pairs
    if (pdfType === "qa" && (lowerSentence.includes("question") || lowerSentence.includes("answer"))) {
      score += 5;
    }
    
    return { sentence, score };
  });
  
  // Filter out low-scoring sentences and sort by score
  const relevantSentences = scoredSentences
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.sentence);
  
  // Return the top 7 most relevant sentences
  return relevantSentences.slice(0, 7).join(". ") + ".";
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

    // Get PDF type
    const pdfData = pdfCollections.get(pdfId);
    const pdfType = pdfData.type || 'general';

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
      k: depth === "deep" || depth === "deeper" ? 10 : 7,
      searchType: "similarity",
      searchKwargs: {
        scoreThreshold: 0.5,
      }
    });

    // Get similar documents
    const results = await retriever.invoke(query);
    
    if (results.length === 0) {
      return res.json({
        query,
        results: `I couldn't find specific information about "${query}" in this document. The document might focus on different topics. Could you try asking about something else or rephrasing your question?`,
        pageReferences: [],
        count: 0
      });
    }

    // Extract content with page references
    const relevantContent = results.map(doc => doc.pageContent).join(" ");
    
    // Extract page numbers from the results
    const pageReferences = extractPageNumbers(relevantContent);
    
    // Filter for the most relevant content based on PDF type
    const filteredContext = filterRelevantContent(relevantContent, query, pdfType);

    // Generate a high-quality answer using Gemini
    let aiResponse = await generateEnhancedAnswer(query, filteredContext, pageReferences, pdfType, depth || "normal");
    
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
    return "Hello! I'm your PDF assistant, ready to help you explore and understand your documents. What would you like to know about your PDF?";
  }
  
  if (/^how are you$/.test(lowerQuery)) {
    return "I'm doing great, thanks for asking! I'm ready to help you understand your document. What would you like to explore today?";
  }
  
  if (/^thanks|thank you|thx/.test(lowerQuery)) {
    return "You're welcome! I'm glad I could help. Is there anything else you'd like to know about your document?";
  }
  
  if (/^good morning|good afternoon|good evening/.test(lowerQuery)) {
    return `${query}! It's a great time to learn something new from your document. What would you like to explore?`;
  }
  
  if (/^what's up|sup/.test(lowerQuery)) {
    return "Just ready to help you understand your documents! What would you like to know?";
  }
  
  if (/^who are you$/.test(lowerQuery)) {
    return "I'm your PDF assistant, here to help you understand and explore the content of your documents. You can ask me questions about anything in your PDF, and I'll provide detailed explanations!";
  }
  
  return "How can I help you with your document today?";
}

app.listen(8000, () =>
  console.log(`✅ Server is running on PORT: 8000`)
)
import { Worker } from "bullmq";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { QdrantClient } from "@qdrant/js-client-rest";

// Load environment variables from .env file
dotenv.config();

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate that Google API key is set
if (!process.env.GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY environment variable is not set");
  console.error("Get your API key from: https://makersuite.google.com/app/apikey");
  process.exit(1);
}

// Initialize Qdrant client for collection management
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333",
});

// Redis connection configuration
const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Function to check if file exists
const fileExists = (path) => {
  try {
    return fs.existsSync(path);
  } catch (err) {
    return false;
  }
};

// Function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to clean up unused collections
const cleanupUnusedCollections = async (currentCollection) => {
  try {
    const collections = await qdrantClient.getCollections();
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const collection of collections.collections) {
      // Skip the current collection and system collections
      if (collection.name === currentCollection || collection.name.startsWith('.')) {
        continue;
      }
      
      // Check if collection is old (more than 24 hours)
      if (collection.creation_time && collection.creation_time < oneDayAgo) {
        console.log(`Deleting old collection: ${collection.name}`);
        await qdrantClient.deleteCollection(collection.name);
        await delay(1000); // Delay between deletions
      }
    }
  } catch (error) {
    console.error("Error during collection cleanup:", error.message);
  }
};

// Function to check if Qdrant is available
const checkQdrantAvailability = async (maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await qdrantClient.getCollections();
      return true;
    } catch (error) {
      console.log(`Qdrant not available (attempt ${i + 1}/${maxRetries}), retrying in 5 seconds...`);
      await delay(5000);
    }
  }
  throw new Error("Qdrant is not available after multiple attempts");
};

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      console.log(`Processing job ${job.id}: ${job.name}`);
      
      // Check if Qdrant is available before processing
      await checkQdrantAvailability();
      
      // Validate job data
      if (!job.data || !job.data.path || !job.data.pdfId) {
        throw new Error("Job data is missing required fields");
      }

      // Check if file exists
      if (!fileExists(job.data.path)) {
        throw new Error(`File not found at path: ${job.data.path}`);
      }

      // Load the PDF with metadata to preserve page numbers
      console.log("Loading PDF...");
      const loader = new PDFLoader(job.data.path, {
        parsedItemSeparator: " ",
      });
      
      const docs = await loader.load();
      
      if (!docs || docs.length === 0) {
        throw new Error("No content extracted from PDF");
      }
      
      console.log(`Extracted ${docs.length} pages from PDF`);

      // Split text into chunks while preserving metadata
      console.log("Splitting text into chunks...");
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,  // Further reduced chunk size
        chunkOverlap: 50,
        separators: ["\n\n", "\n", " ", ""],
      });
      
      const chunks = await textSplitter.splitDocuments(docs);
      console.log(`Created ${chunks.length} text chunks`);

      // Initialize Google Gemini embeddings
      console.log("Initializing Google Gemini embeddings...");
      const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GOOGLE_API_KEY,
        modelName: "embedding-001",
      });

      // Store in Qdrant with PDF-specific collection name
      console.log("Storing vectors in Qdrant...");
      
      // Process chunks in smaller batches with retry logic
      const batchSize = 20;  // Smaller batch size
      const maxRetries = 10; // More retries for Qdrant operations
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(chunks.length / batchSize)}`);
        
        let retries = 0;
        let success = false;
        
        while (retries < maxRetries && !success) {
          try {
            await QdrantVectorStore.fromDocuments(
              batch,
              embeddings,
              {
                url: process.env.QDRANT_URL || "http://localhost:6333",
                collectionName: job.data.pdfId,
              }
            );
            success = true;
            
            // Add a delay between batches to avoid overloading Qdrant
            await delay(2000);
          } catch (error) {
            retries++;
            console.error(`Error processing batch (attempt ${retries}/${maxRetries}):`, error.message);
            
            if (retries >= maxRetries) {
              throw error;
            }
            
            // Exponential backoff with longer delays
            await delay(5000 * retries);
          }
        }
      }

      console.log("Successfully processed PDF and stored vectors using Google Gemini embeddings");
      
      // Clean up unused collections
      await cleanupUnusedCollections(job.data.pdfId);
      
      // Don't delete the file - keep it for future reference
      console.log("File processed successfully:", job.data.path);
      
      return { success: true, chunks: chunks.length, pdfId: job.data.pdfId };
      
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);
      
      // Handle specific errors
      if (error.message.includes('quota') || error.message.includes('429')) {
        console.error("Google API quota exceeded. Please check your billing and quota settings.");
      } else if (error.message.includes('API key') || error.message.includes('401')) {
        console.error("Invalid Google API key. Please check your GOOGLE_API_KEY environment variable.");
      } else if (error.message.includes('timeout') || error.message.includes('aborted')) {
        console.error("Qdrant timeout error. Please check if Qdrant is running and accessible.");
      } else if (error.message.includes('Qdrant is not available')) {
        console.error("Qdrant is not available. Please start Qdrant and try again.");
      }
      
      throw error;
    }
  },
  {
    concurrency: 1,  // Single concurrency to avoid overloading
    connection: redisConnection,
    settings: {
      backoffStrategies: {
        exponential: (attemptsMade) => Math.min(attemptsMade * 1000, 60000),
      }
    }
  }
);

// Handle worker events
worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job.id} failed with error:`, error.message);
  
  // Specific handling for API errors
  if (error.message.includes('quota') || error.message.includes('429')) {
    console.error("ACTION REQUIRED: Google API quota exceeded. Please check your billing.");
  } else if (error.message.includes('API key') || error.message.includes('401')) {
    console.error("ACTION REQUIRED: Invalid Google API key. Please check your GOOGLE_API_KEY.");
  } else if (error.message.includes('timeout') || error.message.includes('aborted')) {
    console.error("ACTION REQUIRED: Qdrant timeout error. Please check if Qdrant is running.");
  } else if (error.message.includes('Qdrant is not available')) {
    console.error("ACTION REQUIRED: Qdrant is not available. Please start Qdrant and try again.");
  }
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("PDF processing worker started with Google Gemini embeddings");
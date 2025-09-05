// check-qdrant.js
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from 'dotenv';

dotenv.config();

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333",
});

async function checkQdrant() {
  try {
    const collections = await qdrantClient.getCollections();
    console.log(`Qdrant is available. Collections: ${collections.collections.length}`);
    return true;
  } catch (error) {
    console.error("Qdrant is not available:", error.message);
    process.exit(1);
  }
}

checkQdrant();
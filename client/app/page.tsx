// app/page.tsx
'use client';

import { FileUpload } from "./components/FileUpload";
import { ChatComponent } from "./components/ChatComponent";
import { useState, useEffect } from 'react';

export default function Home() {
  const [currentPdfId, setCurrentPdfId] = useState('');
  const [currentFilename, setCurrentFilename] = useState('');

  // Load PDF info from localStorage on component mount
  useEffect(() => {
    const storedPdfId = localStorage.getItem('currentPdfId');
    const storedFilename = localStorage.getItem('currentFilename');
    
    if (storedPdfId) {
      setCurrentPdfId(storedPdfId);
    }
    
    if (storedFilename) {
      setCurrentFilename(storedFilename);
    }
  }, []);

  const handlePdfUpload = (pdfId: string, filename: string) => {
    setCurrentPdfId(pdfId);
    setCurrentFilename(filename);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">PDF Chat Assistant</h1>
          <p className="text-sm text-gray-500">Upload a PDF and ask questions about its content</p>
        </div>
      </header>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-1/3">
            <FileUpload 
              onPdfUpload={handlePdfUpload} 
              currentPdfId={currentPdfId}
            />
          </div>
          <div className="w-full lg:w-2/3">
            <ChatComponent 
              currentPdfId={currentPdfId} 
              currentFilename={currentFilename} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
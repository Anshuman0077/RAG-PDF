// app/components/FileUpload.tsx
'use client';

import React, { useState } from 'react';

interface UploadResponse {
  message: string;
  file: any;
  pdfId: string;
  status: string;
}

interface FileUploadProps {
  onPdfUpload: (pdfId: string, filename: string) => void;
  currentPdfId: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onPdfUpload, currentPdfId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [pdfId, setPdfId] = useState(currentPdfId || '');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check if file is PDF
    if (file.type !== 'application/pdf') {
      setUploadMessage('Please upload a PDF file');
      return;
    }

    setIsUploading(true);
    setUploadMessage('');

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await fetch('http://localhost:8000/upload/pdf', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data: UploadResponse = await response.json();
        setUploadMessage('File uploaded successfully! Processing...');
        setPdfId(data.pdfId);
        
        // Store the PDF ID in localStorage for later use
        localStorage.setItem('currentPdfId', data.pdfId);
        localStorage.setItem('currentFilename', file.name);
        
        // Notify parent component about the new PDF
        onPdfUpload(data.pdfId, file.name);
      } else {
        const errorData = await response.json();
        setUploadMessage(`Upload failed: ${errorData.error || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadMessage('Upload error. Please check if the server is running.');
    } finally {
      setIsUploading(false);
    }
  };

  const clearCurrentPdf = () => {
    localStorage.removeItem('currentPdfId');
    localStorage.removeItem('currentFilename');
    setPdfId('');
    onPdfUpload('', '');
    setUploadMessage('PDF selection cleared');
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md h-full">
      <h2 className="text-xl font-semibold mb-4">Upload PDF</h2>
      
      {pdfId && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium text-blue-800">Active PDF: {localStorage.getItem('currentFilename')}</p>
              <p className="text-sm text-blue-600 mt-1">ID: {pdfId.substring(0, 8)}...</p>
            </div>
            <button
              onClick={clearCurrentPdf}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
        <input
          type="file"
          id="file-upload"
          accept=".pdf"
          onChange={handleFileUpload}
          className="hidden"
          disabled={isUploading}
        />
        <label
          htmlFor="file-upload"
          className={`cursor-pointer flex flex-col items-center justify-center space-y-2 ${
            isUploading ? 'opacity-50' : ''
          }`}
        >
          <svg
            className="w-12 h-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="text-gray-600">
            {isUploading ? 'Uploading...' : 'Click to upload PDF'}
          </span>
          <span className="text-xs text-gray-500">(Max size: 10MB)</span>
        </label>
      </div>
      
      {uploadMessage && (
        <div className={`mt-4 p-3 rounded-md ${
          uploadMessage.includes('successfully') ? 'bg-green-100 text-green-800 border border-green-200' : 
          uploadMessage.includes('cleared') ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' : 
          'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {uploadMessage}
        </div>
      )}
      
      <div className="mt-6 text-sm text-gray-500">
        <h3 className="font-medium mb-2">How it works:</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Upload a PDF file</li>
          <li>The system will process and index the content</li>
          <li>Ask questions about the document content</li>
          <li>Get accurate answers with page references</li>
        </ol>
      </div>
    </div>
  );
};
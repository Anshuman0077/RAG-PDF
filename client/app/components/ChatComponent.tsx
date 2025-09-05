'use client';

import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  pageReferences?: number[];
}

interface ChatResponse {
  query: string;
  results: string;
  pageReferences: number[];
  count: number;
}

interface ChatComponentProps {
  currentPdfId: string;
  currentFilename: string;
}

export const ChatComponent: React.FC<ChatComponentProps> = ({ currentPdfId, currentFilename }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [responseDepth, setResponseDepth] = useState<'normal' | 'simple' | 'deep' | 'deeper' | 'step-by-step'>('normal');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputMessage.trim() || isLoading || !currentPdfId) return;

    // Check if user is requesting specific depth in their message
    const userMessageLower = inputMessage.toLowerCase();
    let depth = responseDepth;
    
    if (userMessageLower.includes('step by step') || userMessageLower.includes('step-by-step')) {
      depth = 'step-by-step';
    } else if (userMessageLower.includes('more depth') || userMessageLower.includes('go deeper')) {
      depth = 'deeper';
    } else if (userMessageLower.includes('in depth') || userMessageLower.includes('detailed')) {
      depth = 'deep';
    } else if (userMessageLower.includes('simple') || userMessageLower.includes('easy') || userMessageLower.includes('explain like')) {
      depth = 'simple';
    }

    // Add user message to chat
    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Send query to backend with PDF ID and depth
      const response = await axios.post<ChatResponse>(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/chat`, 
        { 
          query: inputMessage,
          pdfId: currentPdfId,
          depth: depth
        }
      );

      const data = response.data;
      
      // Add AI response to chat with page references
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.results || 'No response received',
        isUser: false,
        timestamp: new Date(),
        pageReferences: data.pageReferences || [],
      };

      setMessages(prev => [...prev, aiMessage]);
      
    } catch (error: any) {
      console.error('Chat error:', error);
      
      // Add error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `Sorry, I encountered an error: ${error.response?.data?.error || error.message || 'Please try again.'}`,
        isUser: false,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const clearChat = () => {
    setMessages([]);
  };

  // Render formatted content with proper line breaks and lists
  const renderFormattedContent = (content: string) => {
    if (!content) return null;
    
    // Split content into paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    
    return paragraphs.map((paragraph, index) => {
      // Check if this is a list
      if (paragraph.includes('- ') || paragraph.includes('* ') || /^\d+\./.test(paragraph)) {
        const lines = paragraph.split('\n').filter(line => line.trim().length > 0);
        const isOrderedList = /^\d+\./.test(lines[0]);
        
        return (
          <div key={index} className={isOrderedList ? 'ordered-list' : 'unordered-list'}>
            {lines.map((line, lineIndex) => {
              const listItem = line.replace(/^[-*]\s+|\d+\.\s+/, '');
              return (
                <div key={lineIndex} className="flex">
                  <span className="mr-2">{isOrderedList ? `${lineIndex + 1}.` : '•'}</span>
                  <span>{listItem}</span>
                </div>
              );
            })}
          </div>
        );
      }
      
      // Regular paragraph
      return <p key={index} className="mb-2">{paragraph}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-md">
      <div className="p-4 border-b flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Chat with your PDF</h2>
          {currentPdfId ? (
            <div className="text-sm text-gray-500 mt-1">
              Active PDF: {currentFilename || 'Unknown filename'}
              <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                ID: {currentPdfId.substring(0, 8)}...
              </span>
            </div>
          ) : (
            <p className="text-sm text-red-500 mt-1">
              No PDF uploaded yet. Please upload a PDF first.
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-500">Depth:</span>
            <select 
              value={responseDepth}
              onChange={(e) => setResponseDepth(e.target.value as any)}
              className="text-xs border rounded p-1 bg-white"
            >
              <option value="normal">Normal</option>
              <option value="simple">Simple</option>
              <option value="deep">Detailed</option>
              <option value="deeper">Very Detailed</option>
              <option value="step-by-step">Step-by-Step</option>
            </select>
          </div>
          
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Clear Chat
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 max-w-md">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-gray-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="font-medium">Send a message to start chatting with your PDF</p>
              <p className="text-sm mt-2">
                Ask specific questions to get precise answers with page references.
                <br />
                Try phrases like:
                <ul className="text-left mt-2 text-xs">
                  <li>"Explain this step by step"</li>
                  <li>"Go deeper into this concept"</li>
                  <li>"Simplify this explanation"</li>
                  <li>"Give me more details about this"</li>
                </ul>
              </p>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <div
              key={message.id}
              className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md xl:max-w-lg rounded-lg p-4 ${
                  message.isUser
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-800 shadow-sm'
                }`}
              >
                {message.isUser ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : (
                  <div className="whitespace-pre-wrap">
                    {renderFormattedContent(message.content)}
                  </div>
                )}
                
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-opacity-20">
                  <p className={`text-xs ${message.isUser ? 'text-blue-200' : 'text-gray-500'}`}>
                    {formatTime(message.timestamp)}
                  </p>
                  {!message.isUser && message.pageReferences && message.pageReferences.length > 0 && (
                    <p className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                      Pages: {message.pageReferences.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-800 rounded-lg p-4 shadow-sm max-w-xs lg:max-w-md xl:max-w-lg">
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
                <span className="text-sm">Analyzing document and crafting response...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSendMessage} className="p-4 border-t bg-white">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            placeholder={currentPdfId ? "Ask a question about the document..." : "Upload a PDF to start chatting"}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            disabled={isLoading || !currentPdfId}
          />
          <button
            type="submit"
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors flex-shrink-0"
            disabled={isLoading || !inputMessage.trim() || !currentPdfId}
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {!currentPdfId 
            ? "Upload a PDF to start chatting" 
            : "Tip: Use phrases like 'explain step by step', 'go deeper', or 'simplify this' to control response detail"
          }
        </p>
      </form>

      <style jsx>{`
        .ordered-list, .unordered-list {
          margin: 0.5rem 0;
        }
        .ordered-list div, .unordered-list div {
          margin: 0.25rem 0;
        }
      `}</style>
    </div>
  );
};
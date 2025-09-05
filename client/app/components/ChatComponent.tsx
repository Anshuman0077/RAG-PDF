// app/components/ChatComponent.tsx
'use client';

import React, { useState, useRef, useEffect } from 'react';

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
  const [conversationDepth, setConversationDepth] = useState<'normal' | 'deep' | 'deeper'>('normal');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputMessage.trim() || isLoading || !currentPdfId) return;

    // Check if user is requesting more depth
    const userMessageLower = inputMessage.toLowerCase();
    let depth = conversationDepth;
    
    if (userMessageLower.includes('more depth') || userMessageLower.includes('go deeper') || 
        userMessageLower.includes('in depth') || userMessageLower.includes('detailed')) {
      depth = depth === 'normal' ? 'deep' : 'deeper';
      setConversationDepth(depth);
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
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query: inputMessage,
          pdfId: currentPdfId,
          depth: depth
        }),
      });

      if (response.ok) {
        const data: ChatResponse = await response.json();
        
        // Add AI response to chat with page references
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: data.results || 'No response received',
          isUser: false,
          timestamp: new Date(),
          pageReferences: data.pageReferences || [],
        };

        setMessages(prev => [...prev, aiMessage]);
        
        // Reset depth after providing a detailed response
        if (depth !== 'normal') {
          setConversationDepth('normal');
        }
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get response');
      }
    } catch (error:any) {
      console.error('Chat error:', error);
      
      // Add error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `Sorry, I encountered an error: ${error.message || 'Please try again.'}`,
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
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-100">
              {conversationDepth === 'normal' ? 'Normal' : 
               conversationDepth === 'deep' ? 'Deep' : 'Deeper'}
            </span>
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
                Say "more depth" or "go deeper" for detailed explanations.
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
                <div className="whitespace-pre-wrap">{message.content}</div>
                
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
                <span className="text-sm">Searching document...</span>
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
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading || !currentPdfId}
          />
          <button
            type="submit"
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
            disabled={isLoading || !inputMessage.trim() || !currentPdfId}
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {!currentPdfId 
            ? "Upload a PDF to start chatting" 
            : "Tip: Ask specific questions or say 'more depth' for detailed explanations"
          }
        </p>
      </form>
    </div>
  );
};
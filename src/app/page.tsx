'use client'

import React, { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import axios from 'axios'
import { FiSend, FiCamera } from 'react-icons/fi'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import html2canvas from 'html2canvas'

// Configuration constants
const STREAM_DURATION_MS = 1000 // Total duration for streaming in milliseconds

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  sources?: {
    url: string
    title?: string
  }[]
}

interface StreamChunk {
  type: 'reasoning' | 'answer'
  content: string
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const [streamingSources, setStreamingSources] = useState<Array<{url: string, title?: string}>>([])

  const streamResponse = async (response: string) => {
    setStreamingReasoning('')
    setStreamingAnswer('')
    const chars = response.split('')
    const delayPerChar = STREAM_DURATION_MS / chars.length
    
    for (let i = 0; i < chars.length; i++) {
      await new Promise(resolve => setTimeout(resolve, delayPerChar))
      setStreamingAnswer(prev => prev + chars[i])
    }
    setStreamingAnswer('')
    setMessages(prev => [...prev, { role: 'assistant', content: response }])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || loading) return

    setStreamingSources([])
    const userMessage = { role: 'user', content: query } as ChatMessage
    setMessages(prev => [...prev, userMessage])
    setLoading(true)
    setQuery('')
    setStreamingReasoning('')
    setStreamingAnswer('')

    let fullReasoning = ''
    let fullAnswer = ''

    try {
      // Convert existing messages to API format
      const messageHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      // Add the new query
      messageHistory.push({
        role: 'user',
        content: query
      })

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messageHistory  // Send full message history
        }),
      })

      console.log('Response status:', response.status) // Debug log

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Network response was not ok')
      }
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        let buffer = ''
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const text = decoder.decode(value)
          buffer += text
          
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            try {
              const cleanLine = line.trim()
              if (!cleanLine || cleanLine === '[DONE]') continue
              
              const chunk: StreamChunk = JSON.parse(cleanLine)
              
              if (chunk.type === 'reasoning') {
                fullReasoning += chunk.content
                setStreamingReasoning(prev => prev + chunk.content)
              } else if (chunk.type === 'answer') {
                fullAnswer += chunk.content
                setStreamingAnswer(prev => prev + chunk.content)
              }
            } catch (e) {
              console.error('Error parsing line:', line)
              continue
            }
          }
        }

        // Process any remaining buffer
        if (buffer) {
          try {
            const chunk: StreamChunk = JSON.parse(buffer)
            if (chunk.type === 'reasoning') {
              fullReasoning += chunk.content
              setStreamingReasoning(prev => prev + chunk.content)
            } else if (chunk.type === 'answer') {
              fullAnswer += chunk.content
              setStreamingAnswer(prev => prev + chunk.content)
            }
          } catch (e) {
            console.error('Error parsing final buffer:', buffer)
          }
        }

        // Add the complete message
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: fullAnswer,
            reasoning: fullReasoning,
            sources: response.sources
          }
        ])
        
        setLoading(false)  // Make sure loading is set to false
      }
    } catch (error) {
      console.error('Error:', error)
      setLoading(false)  // Also set loading to false on error
    } finally {
      // Clean up
      setStreamingReasoning('')
      setStreamingAnswer('')
      setLoading(false)  // Ensure loading is always set to false
    }
  }

  const handleScreenshot = async () => {
    const chatElement = document.getElementById('chat-container')
    if (!chatElement) return

    try {
      // Save current scroll position and container height
      const scrollTop = chatElement.scrollTop
      const originalHeight = chatElement.style.height
      const originalOverflow = chatElement.style.overflow

      // Temporarily modify the container to show all content
      chatElement.style.height = 'auto'
      chatElement.style.overflow = 'visible'

      // Take screenshot
      const canvas = await html2canvas(chatElement, {
        backgroundColor: null,
        scale: 2, // Higher quality
        height: chatElement.scrollHeight,
        windowHeight: chatElement.scrollHeight,
        scrollY: -window.scrollY, // Compensate for page scroll
        onclone: (clonedDoc) => {
          // Find the cloned element in the cloned document
          const clonedChat = clonedDoc.getElementById('chat-container')
          if (clonedChat) {
            // Apply styles to the cloned element
            clonedChat.style.height = 'auto'
            clonedChat.style.overflow = 'visible'
          }
        }
      })

      // Restore original container styles
      chatElement.style.height = originalHeight
      chatElement.style.overflow = originalOverflow
      chatElement.scrollTop = scrollTop

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) return

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `chat-${new Date().toISOString().slice(0, 10)}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }, 'image/png')
    } catch (error) {
      console.error('Screenshot error:', error)
    }
  }

  const components: Components = {
    code({ node, inline, className, children, ...props }) {
      return (
        <code
          className={`${className} ${
            inline ? 'bg-gray-700 rounded px-1' : 'block bg-gray-700 p-2 rounded-lg'
          }`}
          {...props}
        >
          {children}
        </code>
      )
    },
    pre({ children }) {
      return <pre className="bg-transparent overflow-auto">{children}</pre>
    },
    p({ children }) {
      return <p className="mb-2 last:mb-0">{children}</p>
    },
    a({ children, href }) {
      return (
        <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    }
  }

  const renderMessage = (content: string, isReasoning: boolean = false) => {
    const cleanContent = content
      .split(/\n{2,}|\d+\.\s+/)
      .filter(Boolean)
      .map(para => para.trim())
      .join('\n\n')
    
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        className={`prose prose-invert max-w-none whitespace-pre-wrap ${
          isReasoning ? 'text-xs text-gray-500' : ''
        }`}
        components={{
          ...components,
          p: ({ children }) => (
            <p className={`mb-2 last:mb-0 ${isReasoning ? 'text-xs text-gray-500' : ''}`}>
              {children}
            </p>
          ),
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    )
  }

  const renderAssistantMessage = (message: ChatMessage) => {
    return (
      <div className="max-w-[85%] space-y-3 print:max-w-full">
        {/* Sources section - moved to top */}
        {message.sources && message.sources.length > 0 && (
          <div className="bg-gray-800/50 rounded-lg p-4 shadow-md print:bg-gray-800">
            <div className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-medium">
              Sources
            </div>
            <div className="space-y-2">
              {message.sources.map((source, index) => (
                <div key={index} className="flex items-start space-x-2">
                  <span className="text-gray-500 text-xs">[{index + 1}]</span>
                  <a 
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer" 
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    {source.title || source.url}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reasoning section */}
        {message.reasoning && (
          <div className="bg-gray-800/50 rounded-lg p-4 text-[11px] text-gray-500 shadow-md print:bg-gray-800">
            <div className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-medium">
              Reasoning
            </div>
            {renderMessage(message.reasoning, true)}
          </div>
        )}
        
        {/* Answer section */}
        <div className="bg-gray-800 rounded-2xl px-5 py-4 shadow-md print:bg-gray-800">
          <div className="text-xs uppercase tracking-wide mb-2 text-gray-500 font-medium">
            Answer
          </div>
          <div className="text-gray-100">
            {renderMessage(message.content, false)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black flex items-center justify-center p-4">
      {/* Chat container with max width and shadow */}
      <div className="w-full max-w-5xl bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-800">
        {/* Optional header */}
        <header className="px-6 py-4 border-b border-gray-800 bg-gray-900/50 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-white">AI Assistant</h1>
          <button
            onClick={handleScreenshot}
            className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-gray-800 transition-colors"
            title="Take Screenshot"
          >
            <FiCamera className="w-5 h-5" />
          </button>
        </header>

        {/* Main chat area */}
        <main className="h-[70vh] flex flex-col">
          {/* Messages container */}
          <div id="chat-container" className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <h1 className="text-2xl font-medium text-gray-400">
                  Ask me anything...
                </h1>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'user' ? (
                    <div className="max-w-[70%] rounded-2xl px-5 py-3 bg-blue-600 text-white shadow-md print:bg-blue-600">
                      {message.content}
                    </div>
                  ) : (
                    renderAssistantMessage(message)
                  )}
                </div>
              ))
            )}

            {/* Streaming messages */}
            {(loading || streamingReasoning || streamingAnswer) && (
              <div className="flex justify-start">
                <div className="max-w-full space-y-3">
                  {/* Add streaming sources section */}
                  {streamingSources && streamingSources.length > 0 && (
                    <div className="bg-gray-800/50 rounded-lg p-4 shadow-md print:bg-gray-800">
                      <div className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-medium">
                        Sources
                      </div>
                      <div className="space-y-2">
                        {streamingSources.map((source, index) => (
                          <div key={index} className="flex items-start space-x-2">
                            <span className="text-gray-500 text-xs">[{index + 1}]</span>
                            <a 
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer" 
                              className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                            >
                              {source.title || source.url}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {streamingReasoning && (
                    <div className="bg-gray-800/50 rounded-lg p-4 text-[11px] text-gray-500 shadow-md">
                      <div className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-medium">
                        Reasoning
                      </div>
                      {renderMessage(streamingReasoning, true)}
                    </div>
                  )}
                  {streamingAnswer && (
                    <div className="bg-gray-800 rounded-2xl px-5 py-4 shadow-md">
                      <div className="text-xs uppercase tracking-wide mb-2 text-gray-500 font-medium">
                        Answer
                      </div>
                      <div className="text-gray-100">
                        {renderMessage(streamingAnswer, false)}
                      </div>
                    </div>
                  )}
                  {(!streamingReasoning && !streamingAnswer) && (
                    <div className="bg-gray-800 rounded-2xl px-5 py-3 shadow-md">
                      <div className="typing-indicator">
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="p-4 border-t border-gray-800 bg-gray-900/50">
            <form onSubmit={handleSubmit} className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask anything..."
                className="w-full px-6 py-3 pr-12 bg-gray-800 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-gray-700"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiSend className="w-5 h-5" />
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}

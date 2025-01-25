import { NextResponse } from 'next/server';

const DEEPSEEK_API_KEY = process.env.AI_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

if (!DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY is not set in environment variables');
}

if (!TAVILY_API_KEY) {
  throw new Error('TAVILY_API_KEY is not set in environment variables');
}

// Set response timeout to 30 seconds
export const maxDuration = 30;

// Configure the runtime to use edge for better streaming support
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// Function to get context from Tavily
async function getTavilyContext(query: string) {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': TAVILY_API_KEY,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: false,
        max_results: 3
      }),
    });

    if (!response.ok) {
      throw new Error('Tavily API request failed');
    }

    const data = await response.json();
    
    // Format the context from search results
    const context = data.results
      .map(result => `${result.content}\nSource: ${result.url}`)
      .join('\n\n');

    return context;
  } catch (error) {
    console.error('Tavily search error:', error);
    return '';
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    console.log('Received messages:', messages);

    // Get the latest user message
    const latestMessage = messages[messages.length - 1];
    
    // Initialize messagesWithContext with default value
    let messagesWithContext = messages;
    
    // Get context from Tavily endpoint
    try {
      // Use the correct URL format for the same origin
      const tavilyResponse = await fetch(new URL('/api/tavily', req.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: latestMessage.content }),
      });

      if (!tavilyResponse.ok) {
        console.error('Failed to get Tavily context:', await tavilyResponse.text());
        throw new Error('Failed to get Tavily context');
      }

      const { context = '' } = await tavilyResponse.json();
      console.log('Got Tavily context:', context.substring(0, 100) + '...');

      // Update messagesWithContext with context
      messagesWithContext = [
        {
          role: 'system',
          content: `You are an AI assistant. Use the following context from recent web searches to help answer the user's question, but don't mention that you're using search results unless specifically asked. Here's the context:\n\n${context}`
        },
        ...messages
      ];
    } catch (error) {
      console.error('Tavily request error:', error);
      // Continue with default messages if Tavily fails
    }

    // Format messages for DeepSeek API
    const formattedMessages = messagesWithContext.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages: formattedMessages,  // Send formatted message history
        stream: true,
        max_tokens: 8000,
        temperature: 0.7,
        reasoning_stream: true
      }),
    });

    console.log('DeepSeek API response status:', response.status); // Debug log

    if (!response.ok) {
      const error = await response.json();
      console.error('DeepSeek API error:', error); // Debug log
      throw new Error(error.message || 'Failed to get response from DeepSeek');
    }

    if (!response.body) {
      throw new Error('No response body available');
    }

    const reader = response.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              controller.close();
              break;
            }

            const text = decoder.decode(value);
            const lines = text.split('\n');

            for (const line of lines) {
              if (line.trim() === '') continue;
              if (line.trim() === 'data: [DONE]') continue;

              let data = line;
              if (line.startsWith('data: ')) {
                data = line.slice(6);
              }

              try {
                const parsed = JSON.parse(data)
                const content = parsed.choices?.[0]?.delta

                if (content?.reasoning_content) {
                  const chunk = {
                    type: 'reasoning',
                    content: content.reasoning_content
                  }
                  controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
                }
                
                if (content?.content) {
                  const chunk = {
                    type: 'answer',
                    content: content.content
                  }
                  controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
                }
              } catch (e) {
                // Skip invalid JSON chunks silently
                continue
              }
            }
          }
        } catch (e) {
          controller.error(e);
        }
      },

      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
} 
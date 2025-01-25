import { NextResponse } from 'next/server'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY
const TAVILY_API_URL = 'https://api.tavily.com/search'

if (!TAVILY_API_KEY) {
  throw new Error('TAVILY_API_KEY is not set in environment variables')
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json()
    console.log('Tavily search query:', query)

    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: query,
        search_depth: "advanced",
        max_results: 12,
        include_answer: false,
        include_domains: [],
        exclude_domains: [],
        include_raw_content: true,
        max_tokens: 8000,
      }),
    })

    console.log('Tavily API status:', response.status)

    if (!response.ok) {
      const error = await response.json()
      console.error('Tavily API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        error,
      })
      throw new Error(error.message || 'Failed to get response from Tavily')
    }

    const data = await response.json()
    console.log('Tavily search results:', data)

    if (!data.results) {
      console.error('Invalid Tavily API response:', data)
      throw new Error('Invalid response format from Tavily API')
    }

    const contextParts = data.results.map(result => {
      let content = result.content
      
      if (result.raw_content && result.raw_content.length < 8000) {
        content = result.raw_content
      }
      
      return `Content from ${result.title || 'Source'}:
${content}

Source: ${result.url}
${result.published_date ? `Published: ${result.published_date}` : ''}
---`
    })

    const context = contextParts.join('\n\n')

    return NextResponse.json({ 
      context,
      results: data.results,
      response_time: data.response_time
    })
  } catch (error) {
    console.error('Tavily API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    )
  }
} 
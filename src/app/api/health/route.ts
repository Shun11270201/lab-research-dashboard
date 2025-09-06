import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY
  
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    openai_api_key_configured: !!apiKey && apiKey !== 'your_openai_api_key_here',
    openai_api_key_status: apiKey 
      ? apiKey === 'your_openai_api_key_here' 
        ? 'placeholder' 
        : 'configured'
      : 'missing',
    environment: process.env.NODE_ENV || 'unknown',
    vercel: !!process.env.VERCEL,
  })
}
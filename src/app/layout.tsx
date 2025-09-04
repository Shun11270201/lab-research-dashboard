import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '中西研究室ダッシュボード | Research Lab Dashboard',
  description: '研究室専用のダッシュボード - PDF処理、論文翻訳、RAG ChatBotなどの機能を統合',
  keywords: ['research', 'dashboard', 'pdf', 'translation', 'chatbot', 'ai'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className={`${inter.className} antialiased`}>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900">
          {children}
        </div>
      </body>
    </html>
  )
}
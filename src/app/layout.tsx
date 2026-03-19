import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import { Header } from '@/components/layout/header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import './globals.css'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'Multi-agent mission control dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Providers>
          <Header />
          {/* Desktop sidebar */}
          <aside className="fixed top-14 left-0 bottom-0 w-52 border-r border-border bg-background hidden md:block overflow-y-auto">
            <AppSidebar />
          </aside>
          <main className="pt-14 md:pl-52 min-h-screen">
            <div className="p-6">{children}</div>
          </main>
        </Providers>
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import { Header } from '@/components/layout/header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { LayoutShell } from '@/components/layout/layout-shell'
import config from '../../bakin.config'
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
  title: 'Bakin',
  description: 'Multi-agent command dashboard',
}

const themeOverrides = config.theme && Object.keys(config.theme).length > 0
  ? Object.entries(config.theme).map(([k, v]) => `${k}: ${v}`).join('; ')
  : ''

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      {themeOverrides && (
        <head>
          <style dangerouslySetInnerHTML={{ __html: `:root { ${themeOverrides} }` }} />
        </head>
      )}
      <body className="min-h-full bg-background text-foreground">
        <Providers>
          <Header />
          <LayoutShell sidebar={<AppSidebar />}>
            {children}
          </LayoutShell>
        </Providers>
      </body>
    </html>
  )
}

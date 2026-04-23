'use client'

import { useContentStore } from '@bakin/sdk/hooks'
import { parseCalendar } from '@/lib/parsers/calendar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'

function isToday(dateStr: string) {
  return dateStr === new Date().toISOString().split('T')[0]
}

function isPast(dateStr: string) {
  return dateStr < new Date().toISOString().split('T')[0]
}

export function CalendarView() {
  const files = useContentStore((s) => s.files)
  const content = files['CALENDAR.md'] || ''
  const { days, recurring } = parseCalendar(content)

  return (
    <div>
      <h1 className="text-lg font-semibold text-foreground mb-6">Calendar</h1>

      <Tabs defaultValue="events">
        <TabsList className="bg-surface border border-border mb-6">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="recurring">Scheduled</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <div className="flex flex-col gap-6">
            {days.length === 0 && (
              <p className="text-sm text-muted-foreground">No events scheduled.</p>
            )}
            {days.map((day) => (
              <div key={day.date}>
                <div className="flex items-center gap-2 mb-2">
                  <h2
                    className={`text-sm font-semibold ${
                      isToday(day.date)
                        ? 'text-accent'
                        : isPast(day.date)
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                    }`}
                  >
                    {day.date}
                  </h2>
                  {day.label && (
                    <span className="text-xs text-muted-foreground">
                      {day.label}
                    </span>
                  )}
                  {isToday(day.date) && (
                    <Badge variant="secondary" className="text-xs">
                      Today
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1 pl-3 border-l border-border">
                  {day.events.map((event, i) => (
                    <div
                      key={i}
                      className={`flex items-baseline gap-3 py-1 ${
                        isPast(day.date) ? 'opacity-50' : ''
                      }`}
                    >
                      {event.time && (
                        <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">
                          {event.time}
                        </span>
                      )}
                      <span className="text-sm text-foreground">{event.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="recurring">
          <div className="flex flex-col gap-1">
            {recurring.length === 0 && (
              <p className="text-sm text-muted-foreground">No recurring events.</p>
            )}
            {recurring.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-surface transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground w-32 shrink-0">
                  {item.schedule}
                </span>
                <span className="text-sm text-foreground">{item.text}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

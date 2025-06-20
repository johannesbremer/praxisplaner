import { createFileRoute } from "@tanstack/react-router";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
export const Route = createFileRoute("/monat")({
  component: MonthView,
});

export default function MonthView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ end: endDate, start: startDate });
  const today = new Date();

  // Mock appointment counts
  const appointmentCounts: Record<string, number> = {
    "2024-01-15": 12,
    "2024-01-16": 8,
    "2024-01-17": 15,
    "2024-01-18": 10,
    "2024-01-19": 5,
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Monatsansicht</h1>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {format(currentMonth, "MMMM yyyy", { locale: de })}
          </h2>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setCurrentMonth(subMonths(currentMonth, 1));
              }}
              size="icon"
              variant="outline"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => {
                setCurrentMonth(new Date());
              }}
              variant="outline"
            >
              Heute
            </Button>
            <Button
              onClick={() => {
                setCurrentMonth(addMonths(currentMonth, 1));
              }}
              size="icon"
              variant="outline"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-7">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
              <div
                className="p-2 text-center text-sm font-medium text-muted-foreground border-b"
                key={day}
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day, index) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const appointmentCount = appointmentCounts[dateKey] || 0;
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, today);

              return (
                <div
                  className={`
                    min-h-[100px] p-2 border-b border-r
                    ${isCurrentMonth ? "" : "bg-muted/50"}
                    ${isToday ? "bg-primary/5" : ""}
                  `}
                  key={index}
                >
                  <div
                    className={`
                    text-sm font-medium mb-1
                    ${isCurrentMonth ? "" : "text-muted-foreground"}
                    ${isToday ? "text-primary" : ""}
                  `}
                  >
                    {format(day, "d")}
                  </div>

                  {appointmentCount > 0 && isCurrentMonth && (
                    <div className="space-y-1">
                      <div className="text-xs bg-primary/10 text-primary rounded px-2 py-1">
                        {appointmentCount} Termine
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
export const Route = createFileRoute("/woche")({
  component: WeekView,
});

export default function WeekView() {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });

  const hours = Array.from({ length: 11 }, (_, i) => i + 8); // 8 AM to 6 PM
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Mock appointments
  const appointments = [
    {
      day: 1,
      doctor: "Dr. Müller",
      duration: 1,
      hour: 9,
      id: "1",
      patient: "Max Mustermann",
      type: "Erstberatung",
    },
    {
      day: 2,
      doctor: "Dr. Schmidt",
      duration: 0.5,
      hour: 14,
      id: "2",
      patient: "Anna Schmidt",
      type: "Nachuntersuchung",
    },
    {
      day: 3,
      doctor: "Dr. Weber",
      duration: 2,
      hour: 10,
      id: "3",
      patient: "Gruppentermin",
      type: "Grippeimpfung",
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Wochenansicht</h1>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">
            {format(weekStart, "'Woche vom' d. MMMM", { locale: de })} -{" "}
            {format(addDays(weekStart, 6), "d. MMMM yyyy", { locale: de })}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setCurrentWeek(subWeeks(currentWeek, 1));
              }}
              size="icon"
              variant="outline"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => {
                setCurrentWeek(new Date());
              }}
              variant="outline"
            >
              Heute
            </Button>
            <Button
              onClick={() => {
                setCurrentWeek(addWeeks(currentWeek, 1));
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
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-8 border-b">
                <div className="p-2 text-sm font-medium text-muted-foreground">
                  Zeit
                </div>
                {days.map((day, index) => (
                  <div className="p-2 text-center border-l" key={index}>
                    <div className="font-medium">
                      {format(day, "EEEE", { locale: de })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(day, "d. MMM", { locale: de })}
                    </div>
                  </div>
                ))}
              </div>

              {hours.map((hour) => (
                <div className="grid grid-cols-8 border-b" key={hour}>
                  <div className="p-2 text-sm text-muted-foreground">
                    {hour}:00
                  </div>
                  {days.map((_, dayIndex) => {
                    const appointment = appointments.find(
                      (a) => a.day === dayIndex && a.hour === hour,
                    );

                    return (
                      <div
                        className="relative border-l p-1 h-16"
                        key={dayIndex}
                      >
                        {appointment && (
                          <div
                            className="absolute inset-x-1 bg-primary/10 border border-primary/20 rounded p-1 text-xs"
                            style={{
                              height: `${appointment.duration * 64 - 8}px`,
                            }}
                          >
                            <div className="font-medium truncate">
                              {appointment.patient}
                            </div>
                            <div className="text-muted-foreground truncate">
                              {appointment.type}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

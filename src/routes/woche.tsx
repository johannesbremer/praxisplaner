import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfWeek, addDays, addWeeks, subWeeks } from "date-fns";
import { de } from "date-fns/locale";
import { createFileRoute } from "@tanstack/react-router";
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
      id: "1",
      day: 1,
      hour: 9,
      duration: 1,
      patient: "Max Mustermann",
      type: "Erstberatung",
      doctor: "Dr. Müller",
    },
    {
      id: "2",
      day: 2,
      hour: 14,
      duration: 0.5,
      patient: "Anna Schmidt",
      type: "Nachuntersuchung",
      doctor: "Dr. Schmidt",
    },
    {
      id: "3",
      day: 3,
      hour: 10,
      duration: 2,
      patient: "Gruppentermin",
      type: "Grippeimpfung",
      doctor: "Dr. Weber",
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
              variant="outline"
              size="icon"
              onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentWeek(new Date())}
            >
              Heute
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
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
                  <div key={index} className="p-2 text-center border-l">
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
                <div key={hour} className="grid grid-cols-8 border-b">
                  <div className="p-2 text-sm text-muted-foreground">
                    {hour}:00
                  </div>
                  {days.map((_, dayIndex) => {
                    const appointment = appointments.find(
                      (a) => a.day === dayIndex && a.hour === hour,
                    );

                    return (
                      <div
                        key={dayIndex}
                        className="relative border-l p-1 h-16"
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

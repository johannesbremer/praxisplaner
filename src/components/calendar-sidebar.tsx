"use client";

import { format } from "date-fns";
import { de } from "date-fns/locale";
import { AlertCircle, CalendarIcon } from "lucide-react";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";

import { LocationSelector } from "./location-selector";

interface CalendarSidebarProps {
  columns: { id: string; title: string }[];
  currentTime: Date;
  locationsData?: Doc<"locations">[] | undefined;
  onDateChange: (date: Date) => void;
  onLocationSelect: (locationId: Id<"locations"> | undefined) => void;
  selectedDate: Date;
  selectedLocationId: Id<"locations"> | undefined;
  showGdtAlert?: boolean;
}

const APPOINTMENT_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-red-500",
  "bg-yellow-500",
  "bg-indigo-500",
  "bg-gray-500",
];

export function CalendarSidebar({
  columns,
  currentTime,
  locationsData,
  onDateChange,
  onLocationSelect,
  selectedDate,
  selectedLocationId,
  showGdtAlert = false,
}: CalendarSidebarProps) {
  return (
    <Sidebar collapsible="icon" side="left" variant="inset">
      <SidebarHeader>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Praxis Terminkalender
          </h1>
          <p className="text-sm text-muted-foreground">
            Termine verwalten und planen
          </p>
        </div>

        {showGdtAlert && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Keine GDT-Verbindung</AlertTitle>
            <AlertDescription>
              Keine Verbindung mit dem PVS möglich!
            </AlertDescription>
          </Alert>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <CalendarIcon className="h-4 w-4 mr-2" />
            Datum auswählen
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <Card className="p-4">
              <Calendar
                className="rounded-md border-0"
                mode="single"
                onSelect={(date) => {
                  if (date) {
                    onDateChange(date);
                  }
                }}
                selected={selectedDate}
              />
            </Card>
          </SidebarGroupContent>
        </SidebarGroup>

        {locationsData && locationsData.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Standort</SidebarGroupLabel>
            <SidebarGroupContent>
              <Card className="p-4">
                <LocationSelector
                  locations={locationsData}
                  onLocationSelect={onLocationSelect}
                  selectedLocationId={selectedLocationId}
                />
              </Card>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Legende</SidebarGroupLabel>
          <SidebarGroupContent>
            <Card className="p-4">
              <div className="space-y-2">
                {columns.map((column, index) => (
                  <div className="flex items-center gap-2" key={column.id}>
                    <div
                      className={`w-3 h-3 rounded ${APPOINTMENT_COLORS[index % APPOINTMENT_COLORS.length]} opacity-80`}
                    />
                    <span className="text-sm">{column.title}</span>
                  </div>
                ))}
              </div>
            </Card>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Bedienung</SidebarGroupLabel>
          <SidebarGroupContent>
            <Card className="p-4">
              <div className="space-y-2 text-xs text-muted-foreground">
                <div>• Termine ziehen zum Verschieben</div>
                <div>• Unteren Rand ziehen zum Ändern der Dauer</div>
                <div>• Klick auf leere Stellen für neue Termine</div>
                <div>• Klick auf Termin zum Bearbeiten</div>
                <div>• Rechtsklick auf Termin zum Löschen</div>
              </div>
            </Card>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Status</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="text-xs text-muted-foreground space-y-1 px-2">
              <div>Aktuelle Zeit: {format(currentTime, "HH:mm")}</div>
              <div>Gewählt: {format(selectedDate, "dd.MM.yyyy")}</div>
              <div>Tag: {format(selectedDate, "EEEE", { locale: de })}</div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MiniCalendarContextValue {
  currentStartDate: Date;
  days: number;
  onStartDateChange?: (date: Date) => void;
  onValueChange?: (date: Date) => void;
  selectedDate?: Date;
}

const MiniCalendarContext = createContext<MiniCalendarContextValue | undefined>(
  undefined,
);

const useMiniCalendar = () => {
  const context = useContext(MiniCalendarContext);
  if (!context) {
    throw new Error(
      "useMiniCalendar must be used within a MiniCalendar component",
    );
  }
  return context;
};

interface MiniCalendarDayProps {
  className?: string;
  date: Date;
}

interface MiniCalendarDaysProps {
  children: (date: Date) => ReactNode;
  className?: string;
}

interface MiniCalendarNavigationProps {
  className?: string;
  direction: "next" | "prev";
}

interface MiniCalendarProps {
  children: ReactNode;
  className?: string;
  days?: number;
  defaultStartDate?: Date;
  defaultValue?: Date;
  onStartDateChange?: (date: Date) => void;
  onValueChange?: (date: Date) => void;
  startDate?: Date;
  value?: Date;
}

export function MiniCalendar({
  children,
  className,
  days = 5,
  defaultStartDate = new Date(),
  defaultValue,
  onStartDateChange,
  onValueChange,
  startDate,
  value,
}: MiniCalendarProps) {
  const [internalStartDate, setInternalStartDate] = useState(
    startDate ?? defaultStartDate,
  );
  const [internalValue, setInternalValue] = useState(value ?? defaultValue);

  const currentStartDate = startDate ?? internalStartDate;
  const selectedDate = value ?? internalValue;

  const handleStartDateChange = (date: Date) => {
    if (startDate === undefined) {
      setInternalStartDate(date);
    }
    onStartDateChange?.(date);
  };

  const handleValueChange = (date: Date) => {
    if (value === undefined) {
      setInternalValue(date);
    }
    onValueChange?.(date);
  };

  const contextValue: MiniCalendarContextValue = {
    currentStartDate,
    days,
    onStartDateChange: handleStartDateChange,
    onValueChange: handleValueChange,
    ...(selectedDate && { selectedDate }),
  };

  return (
    <MiniCalendarContext.Provider value={contextValue}>
      <div className={cn("flex items-center gap-1", className)}>{children}</div>
    </MiniCalendarContext.Provider>
  );
}

export function MiniCalendarDay({ className, date }: MiniCalendarDayProps) {
  const { currentStartDate, onValueChange, selectedDate } = useMiniCalendar();

  // Check if this date is the simulation start date (first day of mini-calendar)
  const isSimulationDate =
    date.getDate() === currentStartDate.getDate() &&
    date.getMonth() === currentStartDate.getMonth() &&
    date.getFullYear() === currentStartDate.getFullYear();

  const isSelected =
    selectedDate &&
    date.getDate() === selectedDate.getDate() &&
    date.getMonth() === selectedDate.getMonth() &&
    date.getFullYear() === selectedDate.getFullYear();

  const handleClick = () => {
    onValueChange?.(date);
  };

  return (
    <Button
      aria-label={`Select ${date.toLocaleDateString()}`}
      className={cn(
        "h-10 w-10 p-0 flex flex-col items-center justify-center text-xs",
        isSimulationDate && !isSelected && "bg-accent text-accent-foreground",
        className,
      )}
      onClick={handleClick}
      size="sm"
      variant={isSelected ? "default" : "ghost"}
    >
      <span className="text-xs font-medium leading-none">
        {date.toLocaleDateString("de-DE", { weekday: "short" })}
      </span>
      <span className="text-sm font-semibold leading-none">{date.getDate()}</span>
    </Button>
  );
}

export function MiniCalendarDays({
  children,
  className,
}: MiniCalendarDaysProps) {
  const { currentStartDate, days } = useMiniCalendar();

  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(currentStartDate);
    date.setDate(date.getDate() + index);
    return date;
  });

  return (
    <div className={cn("flex gap-0.5", className)}>
      {dates.map((date) => children(date))}
    </div>
  );
}

export function MiniCalendarNavigation({
  className,
  direction,
}: MiniCalendarNavigationProps) {
  const { currentStartDate, days, onStartDateChange } = useMiniCalendar();

  const handleClick = () => {
    const newStartDate = new Date(currentStartDate);
    const offset = direction === "next" ? days : -days;
    newStartDate.setDate(newStartDate.getDate() + offset);
    onStartDateChange?.(newStartDate);
  };

  return (
    <Button
      className={cn("h-6 w-6 p-0", className)}
      onClick={handleClick}
      size="sm"
      variant="outline"
    >
      {direction === "prev" ? (
        <ChevronLeft className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
      <span className="sr-only">
        {direction === "prev" ? "Previous" : "Next"} {days} days
      </span>
    </Button>
  );
}

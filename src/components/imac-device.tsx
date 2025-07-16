import type { ReactNode } from "react";

interface IMacDeviceProps {
  children: ReactNode;
  className?: string;
  color?: "blue" | "green" | "orange" | "pink" | "purple" | "silver" | "yellow";
}

export function IMacDevice({
  children,
  className = "",
  color = "blue",
}: IMacDeviceProps) {
  return (
    <div className={`device-imac device-${color} ${className}`}>
      <div className="device-frame">
        <div className="device-screen">{children}</div>
      </div>
      <div className="device-power"></div>
      <div className="device-home"></div>
    </div>
  );
}

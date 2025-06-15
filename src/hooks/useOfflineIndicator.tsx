import { onlineManager } from "@tanstack/react-query";
import { useEffect } from "react";
import toast from "react-hot-toast";

export function useOfflineIndicator() {
  useEffect(() => {
    return onlineManager.subscribe(() => {
      if (onlineManager.isOnline()) {
        toast.success("online", {
          duration: 2000,
          id: "ReactQuery",
        });
      } else {
        toast.error("offline", {
          duration: Infinity,
          id: "ReactQuery",
        });
      }
    });
  }, []);
}

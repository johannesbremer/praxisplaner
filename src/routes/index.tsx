// src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
  // Replaced Loader with a simple placeholder
  pendingComponent: () => (
    <div className="p-8 text-center">
      <p>Loading...</p>
    </div>
  ),
});

function Home() {
  return (
    <div className="p-8 space-y-2">
      <h1 className="text-2xl font-black">Boards</h1>
    </div>
  );
}

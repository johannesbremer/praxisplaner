import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { toTableId } from "@/convex/identity";

import type { Version } from "../components/version-graph/types";

import VersionGraph from "../components/version-graph/version-graph";

describe("VersionGraph accessibility", () => {
  const versions: Version[] = [
    {
      createdAt: 1_777_680_000_000,
      id: toTableId<"ruleSets">("rule-set-2"),
      message: "Aktuelle Regeln",
      parents: [toTableId<"ruleSets">("rule-set-1")],
    },
    {
      createdAt: 1_777_676_400_000,
      id: toTableId<"ruleSets">("rule-set-1"),
      isActive: true,
      message: "Basis Regeln",
      parents: [],
    },
  ];

  test("exposes one keyboard-accessible version control per version", () => {
    const onVersionClick = vi.fn();
    render(
      <VersionGraph onVersionClick={onVersionClick} versions={versions} />,
    );

    expect(
      screen.getByRole("button", {
        name: "Regelset-Version Aktuelle Regeln auswählen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Regelset-Version Basis Regeln auswählen",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  test("keeps keyboard activation and arrow navigation on the version control", () => {
    const onVersionClick = vi.fn();
    render(
      <VersionGraph onVersionClick={onVersionClick} versions={versions} />,
    );
    const firstVersion = screen.getByRole("button", {
      name: "Regelset-Version Aktuelle Regeln auswählen",
    });

    fireEvent.keyDown(firstVersion, { key: "Enter" });
    fireEvent.keyDown(firstVersion, { key: " " });
    fireEvent.keyDown(firstVersion, { key: "ArrowDown" });

    expect(onVersionClick).toHaveBeenCalledTimes(3);
    expect(onVersionClick).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "Aktuelle Regeln" }),
    );
    expect(onVersionClick).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ message: "Basis Regeln" }),
    );
  });

  test("treats visual graph dots as decorative", () => {
    const { container } = render(<VersionGraph versions={versions} />);

    const decorativeDots = container.querySelectorAll("g[aria-hidden='true']");
    expect(decorativeDots.length).toBeGreaterThan(0);
    for (const dot of decorativeDots) {
      expect(dot).toHaveClass("pointer-events-none");
    }
  });

  test("renders static labels when no version click handler is provided", () => {
    render(<VersionGraph versions={versions} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Aktuelle Regeln")).not.toHaveAttribute("tabindex");
    expect(screen.getByText("Basis Regeln")).not.toHaveAttribute("tabindex");
  });
});

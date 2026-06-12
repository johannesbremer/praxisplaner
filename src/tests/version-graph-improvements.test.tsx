import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { toTableId } from "@/convex/identity";

import type { Version } from "../components/version-graph/types";

import VersionGraph from "../components/version-graph/version-graph";
import { assertElement } from "./test-utils";

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
  const threeVersions: Version[] = [
    {
      createdAt: 1_777_683_600_000,
      id: toTableId<"ruleSets">("rule-set-3"),
      message: "Neue Regeln",
      parents: [toTableId<"ruleSets">("rule-set-2")],
    },
    ...versions,
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

  test("moves focus with arrow navigation so repeated arrows continue through versions", () => {
    const onVersionClick = vi.fn();
    render(
      <VersionGraph onVersionClick={onVersionClick} versions={threeVersions} />,
    );
    const firstVersion = screen.getByRole("button", {
      name: "Regelset-Version Neue Regeln auswählen",
    });
    const secondVersion = screen.getByRole("button", {
      name: "Regelset-Version Aktuelle Regeln auswählen",
    });
    const thirdVersion = screen.getByRole("button", {
      name: "Regelset-Version Basis Regeln auswählen",
    });

    firstVersion.focus();
    fireEvent.keyDown(firstVersion, { key: "ArrowDown" });
    expect(document.activeElement).toBe(secondVersion);

    fireEvent.keyDown(secondVersion, { key: "ArrowDown" });
    expect(document.activeElement).toBe(thirdVersion);

    fireEvent.keyDown(thirdVersion, { key: "ArrowUp" });
    expect(document.activeElement).toBe(secondVersion);
    expect(onVersionClick).toHaveBeenCalledTimes(3);
    expect(onVersionClick).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "Aktuelle Regeln" }),
    );
    expect(onVersionClick).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "Basis Regeln" }),
    );
    expect(onVersionClick).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ message: "Aktuelle Regeln" }),
    );
  });

  test("selects a version when clicking the visible graph node", () => {
    const onVersionClick = vi.fn();
    const { container } = render(
      <VersionGraph onVersionClick={onVersionClick} versions={versions} />,
    );

    const dotHitTargets = container.querySelectorAll(
      "circle[fill='transparent']",
    );
    expect(dotHitTargets).toHaveLength(versions.length);
    const firstDotHitTarget = dotHitTargets[0];
    assertElement(firstDotHitTarget);
    fireEvent.click(firstDotHitTarget);

    expect(onVersionClick).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "Aktuelle Regeln" }),
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
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

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { SEMANTIC_STATUS } from "./tokens";

describe("StatusBadge", () => {
  describe("text rendering", () => {
    it('renders "In Progress" text', () => {
      render(<StatusBadge status="In Progress" />);
      expect(screen.getByText("In Progress")).toBeInTheDocument();
    });

    it('renders "Completed" text', () => {
      render(<StatusBadge status="Completed" />);
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });

    it('renders "Not Started" text', () => {
      render(<StatusBadge status="Not Started" />);
      expect(screen.getByText("Not Started")).toBeInTheDocument();
    });

    it('renders "In Discovery" text', () => {
      render(<StatusBadge status="In Discovery" />);
      expect(screen.getByText("In Discovery")).toBeInTheDocument();
    });

    it('renders "Paused" text', () => {
      render(<StatusBadge status="Paused" />);
      expect(screen.getByText("Paused")).toBeInTheDocument();
    });

    it('renders "Blocked" text', () => {
      render(<StatusBadge status="Blocked" />);
      expect(screen.getByText("Blocked")).toBeInTheDocument();
    });
  });

  describe("SEMANTIC_STATUS color tokens", () => {
    it('applies the correct background color from SEMANTIC_STATUS for "In Progress"', () => {
      render(<StatusBadge status="In Progress" />);
      const badge = screen.getByText("In Progress");
      expect(badge).toHaveStyle({
        backgroundColor: SEMANTIC_STATUS["In Progress"].bg,
      });
    });

    it('applies the correct text color from SEMANTIC_STATUS for "Completed"', () => {
      render(<StatusBadge status="Completed" />);
      const badge = screen.getByText("Completed");
      expect(badge).toHaveStyle({
        color: SEMANTIC_STATUS["Completed"].text,
      });
    });

    it('applies the correct border color from SEMANTIC_STATUS for "Blocked"', () => {
      render(<StatusBadge status="Blocked" />);
      const badge = screen.getByText("Blocked");
      expect(badge).toHaveStyle({
        borderColor: SEMANTIC_STATUS["Blocked"].border,
      });
    });
  });

  describe("unknown status fallback", () => {
    it("falls back to Not Started styles for an unrecognised status", () => {
      render(<StatusBadge status="Unknown Status" />);
      const badge = screen.getByText("Unknown Status");
      // Should use Not Started colors
      expect(badge).toHaveStyle({
        backgroundColor: SEMANTIC_STATUS["Not Started"].bg,
      });
    });
  });

  describe("size prop", () => {
    it('default size "sm" renders the badge with text-xs class', () => {
      render(<StatusBadge status="In Progress" />);
      const badge = screen.getByText("In Progress");
      expect(badge.className).toContain("text-xs");
    });

    it('size "md" renders the badge with text-sm class', () => {
      render(<StatusBadge status="In Progress" size="md" />);
      const badge = screen.getByText("In Progress");
      expect(badge.className).toContain("text-sm");
    });

    it('size "md" does not render text-xs class', () => {
      render(<StatusBadge status="In Progress" size="md" />);
      const badge = screen.getByText("In Progress");
      expect(badge.className).not.toContain("text-xs");
    });

    it('size "sm" has smaller padding than size "md"', () => {
      // sm: px-2 py-0.5  vs  md: px-3 py-1
      const { rerender } = render(<StatusBadge status="In Progress" size="sm" />);
      const smBadge = screen.getByText("In Progress");
      const smClass = smBadge.className;

      rerender(<StatusBadge status="In Progress" size="md" />);
      const mdBadge = screen.getByText("In Progress");
      const mdClass = mdBadge.className;

      expect(smClass).toContain("px-2");
      expect(mdClass).toContain("px-3");
    });
  });

  describe("a11y / structure", () => {
    it("renders a <span> element", () => {
      render(<StatusBadge status="In Progress" />);
      const badge = screen.getByText("In Progress");
      expect(badge.tagName).toBe("SPAN");
    });

    it("has rounded-full class for pill appearance", () => {
      render(<StatusBadge status="Paused" />);
      const badge = screen.getByText("Paused");
      expect(badge.className).toContain("rounded-full");
    });
  });
});

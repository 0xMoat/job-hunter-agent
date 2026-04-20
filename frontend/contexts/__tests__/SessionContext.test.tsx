import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider, useSession } from "@/contexts/SessionContext";

function Probe() {
  const session = useSession();
  return (
    <div data-testid="probe">
      {session ? `loading:${String(session.loading)}` : "no-context"}
    </div>
  );
}

describe("SessionContext", () => {
  it("provides a non-null context value to children inside SessionProvider", () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    // Provider's useEffect early-returns when no access token in localStorage,
    // setting loading=false synchronously after first render. Either "true" or
    // "false" indicates the context exists — only "no-context" would be a fail.
    const probe = screen.getByTestId("probe");
    expect(probe.textContent).toMatch(/^loading:(true|false)$/);
  });

  it("useSession throws when used outside the provider", () => {
    // Suppress React's expected error log for cleaner test output
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow(/useSession must be used within SessionProvider/);
    } finally {
      console.error = originalError;
    }
  });
});

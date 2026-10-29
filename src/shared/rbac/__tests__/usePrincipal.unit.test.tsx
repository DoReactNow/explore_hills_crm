import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrincipalProvider, usePrincipal } from "../usePrincipal";

afterEach(cleanup);

function Probe() {
  const { can } = usePrincipal();
  return (
    <ul>
      <li>diagnostics: {can("system:view-diagnostics") ? "yes" : "no"}</li>
      <li>roles: {can("roles:manage") ? "yes" : "no"}</li>
    </ul>
  );
}

describe("usePrincipal()", () => {
  it("can() is false for everything without a provider (signed out)", () => {
    render(<Probe />);
    expect(screen.getByText("diagnostics: no")).toBeTruthy();
    expect(screen.getByText("roles: no")).toBeTruthy();
  });

  it("can() reflects the permissions given by the server, and prints no codes", () => {
    render(
      <PrincipalProvider permissions={["system:view-diagnostics"]}>
        <Probe />
      </PrincipalProvider>,
    );
    expect(screen.getByText("diagnostics: yes")).toBeTruthy();
    expect(screen.getByText("roles: no")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/system:view-diagnostics/);
  });
});

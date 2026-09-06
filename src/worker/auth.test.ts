import { describe, expect, it } from "vitest";
import { requireAnyPermission, requirePermission } from "./auth";
import { HttpError } from "./http";
import type { SessionUser } from "./types";

const user: SessionUser = {
  id: "user-1",
  name: "Atendente",
  email: "atendente@karrer.test",
  role: "attendant",
  permissions: { chat: true, leads: false, clients: false, settings: false },
};

describe("autorização por módulo", () => {
  it("libera somente a permissão concedida", () => {
    expect(() => requirePermission(user, "chat")).not.toThrow();
    expect(() => requirePermission(user, "settings")).toThrow(HttpError);
  });

  it("aceita quando ao menos uma permissão está disponível", () => {
    expect(() => requireAnyPermission(user, ["leads", "chat"])).not.toThrow();
    expect(() => requireAnyPermission(user, ["leads", "clients"])).toThrow(HttpError);
  });
});

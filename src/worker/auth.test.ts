import { describe, expect, it } from "vitest";
import { requireAdmin, requireAnyPermission, requirePermission } from "./auth";
import { HttpError } from "./http";
import type { SessionUser } from "./types";

const user: SessionUser = {
  id: "user-1",
  name: "Atendente",
  email: "atendente@karrer.test",
  role: "attendant",
  avatarUrl: null,
  professionalRole: "Administrador",
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

  it("reserva a gestão de usuários ao administrador", () => {
    expect(() => requireAdmin(user)).toThrow(HttpError);
    expect(() => requireAdmin({ ...user, role: "admin" })).not.toThrow();
  });
});

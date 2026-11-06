import type { ResourceProps } from "ra-core";
import { ShieldCheck } from "lucide-react";
import { UserCreate, UserEdit, UserList, UserShow } from "./user-pages";

export const users: ResourceProps = {
  name: "users",
  options: { label: "Usuarios" },
  recordRepresentation: "displayName",
  icon: ShieldCheck,
  list: UserList,
  create: UserCreate,
  edit: UserEdit,
  show: UserShow,
};

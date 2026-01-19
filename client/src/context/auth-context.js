import { createContext, useContext } from "react";
/*comentario*/
export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

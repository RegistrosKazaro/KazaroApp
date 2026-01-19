import { createContext, useContext } from "react";
/*comentarop*/ 
export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

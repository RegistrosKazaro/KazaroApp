import { createContext, useContext } from "react";
/*comentario*/ 
export const AuthContext = createContext(null);
/*coment*/
export function useAuth() {
  return useContext(AuthContext);
}

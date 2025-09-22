import { useContext } from "react";
import { CartContext } from "../context/cart-context";

export function useCart() {
  return useContext(CartContext);
}
export default useCart;

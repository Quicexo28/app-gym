import type { HTMLAttributes } from "react";

import { useModalBehavior } from "../lib/useModalBehavior";

type ModalProps = HTMLAttributes<HTMLDivElement> & {
  /** Se llama al pulsar Escape. El cierre por clic en el fondo lo decide cada pantalla con `onClick`. */
  onClose: () => void;
};

/** Fondo `modalOverlay` con Escape y bloqueo de scroll. Se monta solo mientras el modal está abierto. */
export default function Modal({ onClose, className, children, ...rest }: ModalProps) {
  useModalBehavior(true, onClose);
  return (
    <div className={className ? `modalOverlay ${className}` : "modalOverlay"} {...rest}>
      {children}
    </div>
  );
}

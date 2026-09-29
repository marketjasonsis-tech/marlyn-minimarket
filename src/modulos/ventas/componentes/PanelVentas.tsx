"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { coincideBusqueda } from "@/lib/busqueda";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Boton } from "@/componentes/Boton";
import { Campo } from "@/componentes/Campo";
import { AccionesTicket } from "@/componentes/AccionesTicket";
import { Modal } from "@/componentes/Modal";
import { TicketVenta } from "@/componentes/TicketVenta";
import { CANAL_EVENTO_CARRITO, nombreCanalPantalla } from "@/modulos/pantalla/tipos";
import {
  calcularSubtotalItem,
  calcularTotalCarrito,
  calcularVuelto,
  pagosCubrenElTotal,
} from "../consultas/calculos";
import type { Cliente } from "@/modulos/clientes/tipos";
import { aplicarPromociones } from "@/modulos/promociones/consultas/aplicarPromociones";
import { descripcionPromocion, promocionesDeProducto } from "@/modulos/promociones/consultas/descripcionPromocion";
import { productosFaltantesParaCompletar } from "@/modulos/promociones/consultas/productosFaltantes";
import type { Promocion } from "@/modulos/promociones/tipos";
import {
  coincideCodigoExacto,
  contieneCodigo,
  pareceCodigoDeBarras,
} from "@/modulos/stock/consultas/codigosBarras";
import type { Producto } from "@/modulos/stock/tipos";
import type { VentaResumen } from "../consultas/ventas";
import type { ItemCarrito, MedioPago, PagoCarrito } from "../tipos";
import { FilaCarritoItem } from "./FilaCarritoItem";

const ETIQUETA_UNIDAD: Record<Producto["unidad"], string> = {
  unidad: "unidades",
  kg: "kg",
  litro: "L",
};

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const CLAVE_SESSION = "ventas-carritos-en-curso";

const clasesSelect =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-2 text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40";
const clasesFiltro =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-1.5 text-sm text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40";

// "Mixto" no es un medio propio en la base (ventas_pagos.medio admite
// efectivo/transferencia/debito/credito/fiado): son dos filas de pago,
// efectivo + lo que se elija para el resto (antes solo transferencia,
// ahora también débito/crédito — pedido de Jason, 2026-09-10). Acá es
// una opción más de UI que arma esas dos filas al confirmar.
type MedioPagoUi = MedioPago | "mixto";

const CLIENTE_NUEVO = "__nuevo__";

type CarritoEnCurso = {
  id: string;
  items: ItemCarrito[];
  medioPago: MedioPagoUi;
  pagaCon: string;
  montoMixtoEfectivo: string;
  // Con qué se cobra la parte que no es efectivo dentro de "Mixto"
  // (pedido de Jason, 2026-09-10: antes "Mixto" solo repartía entre
  // efectivo y transferencia, hacía falta también con débito/crédito).
  medioMixtoResto: Exclude<MedioPago, "fiado" | "efectivo">;
  clienteId: string;
  nombreClienteNuevo: string;
  montoRecibidoFiado: string;
  medioRecibidoFiado: Exclude<MedioPago, "fiado">;
  // Recargo por débito/crédito (pedido explícito del cliente,
  // 2026-08-24): varía según la tarjeta/plan de cuotas, así que el
  // cajero lo tipea en cada venta — no es una tabla fija de
  // porcentajes por tarjeta. Se traslada al cliente (sube el total).
  porcentajeRecargoTarjeta: string;
};

type Comprobante = {
  items: ItemCarrito[];
  subtotal: number;
  total: number;
  medioTexto: string;
  vuelto: number;
  saldoFiado?: number;
  recargoPorcentaje?: number;
};

function crearCarritoVacio(): CarritoEnCurso {
  return {
    id: crypto.randomUUID(),
    items: [],
    medioPago: "efectivo",
    pagaCon: "",
    montoMixtoEfectivo: "",
    medioMixtoResto: "transferencia",
    clienteId: "",
    nombreClienteNuevo: "",
    montoRecibidoFiado: "",
    medioRecibidoFiado: "efectivo",
    porcentajeRecargoTarjeta: "",
  };
}

function cargarCarritosGuardados(): CarritoEnCurso[] {
  if (typeof window === "undefined") return [crearCarritoVacio()];
  try {
    const guardado = window.sessionStorage.getItem(CLAVE_SESSION);
    const carritos = guardado ? (JSON.parse(guardado) as CarritoEnCurso[]) : null;
    // Un carrito guardado antes de sumar "medioMixtoResto" no lo trae —
    // se completa con el valor que "Mixto" usaba siempre (transferencia)
    // para no romper con un carrito en curso de antes de este cambio.
    return carritos && carritos.length > 0
      ? carritos.map((carrito) => ({ ...carrito, medioMixtoResto: carrito.medioMixtoResto ?? "transferencia" }))
      : [crearCarritoVacio()];
  } catch {
    return [crearCarritoVacio()];
  }
}

export function PanelVentas({
  productos,
  clientes,
  turnoCajaId,
  usuarioId,
  tokenPantalla,
  promociones,
  onVentaConfirmada,
}: {
  productos: Producto[];
  clientes: Cliente[];
  turnoCajaId: string;
  usuarioId: string;
  tokenPantalla: string;
  promociones: Promocion[];
  onVentaConfirmada: (venta: VentaResumen, items: { productoId: string; cantidad: number }[]) => void;
}) {
  // "Adjusting state when a prop changes" (react.dev) — mismo patrón que
  // categorías/proveedores en los formularios de Stock: crear un
  // cliente nuevo acá adentro lo agrega a esta lista local al toque, y
  // un router.refresh() (por cualquier otro motivo) no la pisa con una
  // desactualizada.
  const [clientesVistos, setClientesVistos] = useState(clientes);
  const [listaClientes, setListaClientes] = useState(clientes);
  if (clientes !== clientesVistos) {
    setClientesVistos(clientes);
    setListaClientes(clientes);
  }

  const [carritos, setCarritos] = useState<CarritoEnCurso[]>(cargarCarritosGuardados);
  const [carritoActivoId, setCarritoActivoId] = useState(() => carritos[0].id);
  // Un solo campo para escanear Y para buscar por nombre (antes eran
  // dos cajas apiladas: una de solo-código para el lector y otra de
  // buscar-y-hacer-click — pedido del dueño: unificarlas). Escanear (o
  // tipear un código exacto y Enter) agrega directo, igual que antes;
  // tipear un nombre sigue filtrando la grilla de abajo en vivo.
  const [busqueda, setBusqueda] = useState("");
  const inputBusquedaRef = useRef<HTMLInputElement>(null);

  // Mismo pedido que en Stock (2026-09-11), ahora también acá: a los 2
  // segundos sin tipear, se selecciona todo para escribir encima directo.
  useEffect(() => {
    if (!busqueda) return;
    const temporizador = setTimeout(() => {
      inputBusquedaRef.current?.select();
    }, 2000);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [comprobante, setComprobante] = useState<Comprobante | null>(null);
  // "Nubes" que avisan de una promo al escanear/agregar un producto que
  // participa de alguna, se haya completado o no todavía (pedido de
  // Jason, 2026-09-11: "escaneo el Fernet... que me salga una nube
  // diciendo que hay una promo" — para que el cajero pueda ofrecerle al
  // cliente lo que le falta). Se guardan por id de promo (no el texto ya
  // armado): así se pueden acumular varias a la vez sin duplicar la
  // misma, y el botón "Agregar a la venta" de cada una sabe recalcular
  // en cada render qué falta según el carrito actual. Quedan a la vista
  // hasta que se cierren con la ✕, se completen, o se cambie de venta —
  // un auto-descarte por tiempo hacía que se perdieran antes de que el
  // cajero llegara a leerlas (pedido de Enzo, 2026-09-11).
  const [avisoPromoIds, setAvisoPromoIds] = useState<string[]>([]);

  // Cada pestaña de venta es su propio carrito independiente: cambiar de
  // pestaña ES "guardar para después" (el pedido del cliente), y también
  // resuelve atender a dos personas a la vez desde la misma PC — misma
  // necesidad, mismo mecanismo. Se guarda en sessionStorage (no
  // localStorage: es de esta pestaña del navegador, no algo que deba
  // sobrevivir a cerrarla) para no perder una venta ante un F5 sin querer.
  useEffect(() => {
    window.sessionStorage.setItem(CLAVE_SESSION, JSON.stringify(carritos));
  }, [carritos]);

  const carritoActivo = carritos.find((carrito) => carrito.id === carritoActivoId) ?? carritos[0];

  // Pedido de Jason (2026-09-17): al cargar un producto que ya no
  // entra en el área visible, se seguía viendo el más viejo (scrolleado
  // arriba de todo) — quiere ver el que recién agregó. Se sigue el
  // largo de la lista (no cada cambio del carrito: cambiar una
  // cantidad con +/- no tiene que saltar la vista) y se compara contra
  // el mismo carrito (no dispara al cambiar de pestaña de venta).
  const listaCarritoRef = useRef<HTMLDivElement>(null);
  const carritoAnteriorRef = useRef({ id: carritoActivo.id, cantidad: carritoActivo.items.length });

  useEffect(() => {
    const anterior = carritoAnteriorRef.current;
    const mismoCarrito = anterior.id === carritoActivo.id;
    const creció = carritoActivo.items.length > anterior.cantidad;

    if (mismoCarrito && creció && listaCarritoRef.current) {
      listaCarritoRef.current.scrollTop = listaCarritoRef.current.scrollHeight;
    }

    carritoAnteriorRef.current = { id: carritoActivo.id, cantidad: carritoActivo.items.length };
  }, [carritoActivo.id, carritoActivo.items.length]);

  function actualizarCarritoActivo(cambios: Partial<CarritoEnCurso>) {
    setCarritos((anteriores) =>
      anteriores.map((carrito) => (carrito.id === carritoActivoId ? { ...carrito, ...cambios } : carrito)),
    );
  }

  const avisosPromo = useMemo(
    () =>
      avisoPromoIds
        .map((id) => promociones.find((promocion) => promocion.id === id))
        .filter((promocion): promocion is Promocion => !!promocion)
        .map((promocion) => ({
          promocion,
          descripcion: descripcionPromocion(promocion, productos),
          faltantes: productosFaltantesParaCompletar(carritoActivo.items, promocion),
        })),
    [avisoPromoIds, promociones, productos, carritoActivo.items],
  );

  // Agrega lo que le falta a la promo (respetando el stock disponible)
  // en un solo gesto — pedido de Jason, 2026-09-11: "con un botón, se
  // agreguen los productos de la promo al carrito". Todo o nada: si no
  // alcanza el stock de alguno de los productos, no agrega ninguno —
  // completar la mitad de un combo no destraba nada, solo suma costo.
  function completarPromocion(promocion: Promocion) {
    setError(null);
    const faltantes = productosFaltantesParaCompletar(carritoActivo.items, promocion);
    if (faltantes.length === 0) return;

    const items = [...carritoActivo.items];
    for (const { productoId, cantidad } of faltantes) {
      const producto = productos.find((p) => p.id === productoId);
      if (!producto) continue;

      const cantidadActual = items.find((item) => item.productoId === productoId)?.cantidad ?? 0;
      const disponible = producto.stockActual - cantidadActual;
      if (disponible < cantidad) {
        setError(
          `Solo quedan ${producto.stockActual - cantidadActual} ${ETIQUETA_UNIDAD[producto.unidad]} de ${producto.nombre} — no alcanza para completar la promo`,
        );
        return;
      }

      const indice = items.findIndex((item) => item.productoId === productoId);
      if (indice >= 0) {
        items[indice] = { ...items[indice], cantidad: items[indice].cantidad + cantidad };
      } else {
        items.push({
          productoId,
          nombre: producto.nombre,
          cantidad,
          precioUnitario: producto.precioVenta,
        });
      }
    }

    actualizarCarritoActivo({ items });
    setAvisoPromoIds((anteriores) => anteriores.filter((id) => id !== promocion.id));
  }

  function nuevaVenta() {
    const carrito = crearCarritoVacio();
    setCarritos((anteriores) => [...anteriores, carrito]);
    setCarritoActivoId(carrito.id);
    setError(null);
    setAvisoPromoIds([]);
  }

  function cerrarVenta(id: string) {
    setCarritos((anteriores) => {
      if (anteriores.length === 1) {
        const nuevo = crearCarritoVacio();
        setCarritoActivoId(nuevo.id);
        return [nuevo];
      }
      const restantes = anteriores.filter((carrito) => carrito.id !== id);
      if (id === carritoActivoId) setCarritoActivoId(restantes[0].id);
      return restantes;
    });
    setAvisoPromoIds([]);
  }

  // Se aplican solas, sin que el cajero tenga que acordarse de nada
  // (pedido de Jason, 2026-09-10 — ver PLAN-PROMOCIONES.md): esta es la
  // única lista que ve precios/subtotales de promo, el carrito en sí
  // (carritoActivo.items) sigue siendo lo que el cajero tipeó tal cual.
  const itemsConPromo = useMemo(
    () => aplicarPromociones(carritoActivo.items, promociones),
    [carritoActivo.items, promociones],
  );
  const total = useMemo(() => calcularTotalCarrito(itemsConPromo), [itemsConPromo]);
  const ahorroPromociones = useMemo(
    () => itemsConPromo.reduce((acumulado, item) => acumulado + (item.promoAplicada?.ahorro ?? 0), 0),
    [itemsConPromo],
  );

  // Recargo por débito/crédito: se traslada al cliente, así que el
  // total a cobrar (y lo que se manda a registrar_venta) sube — el
  // total del carrito en sí (arriba) sigue siendo el de los productos.
  // Aplica sobre el total entero si se paga 100% con tarjeta, o solo
  // sobre la parte de tarjeta si es "Mixto con débito/crédito" (pedido
  // de Jason, 2026-09-10: "así como el fiado, tanto en efectivo, tanto
  // con crédito/débito" — la misma idea de repartir un pago que ya
  // existía para fiado, ahora también para tarjeta).
  const esTarjeta = carritoActivo.medioPago === "debito" || carritoActivo.medioPago === "credito";
  const esMixtoConTarjeta =
    carritoActivo.medioPago === "mixto" &&
    (carritoActivo.medioMixtoResto === "debito" || carritoActivo.medioMixtoResto === "credito");
  // Fiado parcial pagado con tarjeta (2026-09-10, mismo pedido que
  // "Mixto con tarjeta"): el recargo va solo sobre lo que efectivamente
  // se cobra ahora con la tarjeta, no sobre lo que queda fiado.
  const esFiadoConTarjeta =
    carritoActivo.medioPago === "fiado" &&
    (carritoActivo.medioRecibidoFiado === "debito" || carritoActivo.medioRecibidoFiado === "credito");
  const montoBaseRecargo = esTarjeta
    ? total
    : esMixtoConTarjeta
      ? Math.max(0, total - (Number(carritoActivo.montoMixtoEfectivo) || 0))
      : esFiadoConTarjeta
        ? Number(carritoActivo.montoRecibidoFiado) || 0
        : 0;
  const recargoMonto =
    montoBaseRecargo > 0
      ? Math.round(montoBaseRecargo * ((Number(carritoActivo.porcentajeRecargoTarjeta) || 0) / 100) * 100) / 100
      : 0;
  const totalConRecargo = total + recargoMonto;

  // Pantalla al cliente: la pestaña activa se emite por Realtime
  // Broadcast (sin tabla, el carrito en curso ya es puramente
  // client-side) — un canal por dueño (tokenPantalla, fijo), abierto
  // mientras este panel esté montado.
  const canalPantallaRef = useRef<RealtimeChannel | null>(null);
  const [canalPantallaListo, setCanalPantallaListo] = useState(false);

  useEffect(() => {
    if (!tokenPantalla) return;
    const supabase = crearClienteNavegador();
    const canal = supabase.channel(nombreCanalPantalla(tokenPantalla));
    canal.subscribe((estado) => setCanalPantallaListo(estado === "SUBSCRIBED"));
    canalPantallaRef.current = canal;

    return () => {
      supabase.removeChannel(canal);
      canalPantallaRef.current = null;
      setCanalPantallaListo(false);
    };
  }, [tokenPantalla]);

  useEffect(() => {
    if (!canalPantallaListo || !canalPantallaRef.current) return;
    canalPantallaRef.current.send({
      type: "broadcast",
      event: CANAL_EVENTO_CARRITO,
      // itemsConPromo (no carritoActivo.items): la TV tiene que ver el
      // mismo precio con promo y el mismo aviso que ve el cajero.
      payload: {
        items: itemsConPromo.map((item) => ({
          productoId: item.productoId,
          nombre: item.nombre,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          porPeso: productos.find((producto) => producto.id === item.productoId)?.unidad !== "unidad",
          subtotal: calcularSubtotalItem(item),
          promoAplicada: item.promoAplicada,
        })),
        total,
      },
    });
    // Se manda con cada cambio del carrito activo: agregar/sacar
    // productos y cambiar de pestaña caen acá solos, porque
    // carritoActivo ya deriva de cuál pestaña está seleccionada.
  }, [canalPantallaListo, itemsConPromo, total, productos]);

  function agregarProducto(producto: Producto) {
    setError(null);
    const enCarrito = carritoActivo.items.find((item) => item.productoId === producto.id);
    const yaCargadas = enCarrito?.cantidad ?? 0;
    const disponible = producto.stockActual - yaCargadas;

    if (disponible <= 0) {
      setError(`Quedan ${producto.stockActual} ${ETIQUETA_UNIDAD[producto.unidad]} de ${producto.nombre}`);
      return;
    }

    // Por kg/litro, "agregar" es un solo click que arranca la fila —
    // el ajuste fino después es por gramos/monto (FilaCarritoItem). Con
    // menos de 1 kg/L en góndola, sumar el paso fijo de 1 la bloqueaba
    // por completo aunque hubiera de sobra para vender una fracción; el
    // paso queda acotado a lo que realmente queda.
    const esPeso = producto.unidad === "kg" || producto.unidad === "litro";
    const incremento = esPeso ? Math.round(Math.min(1, disponible) * 1000) / 1000 : 1;

    const items = enCarrito
      ? carritoActivo.items.map((item) =>
          item.productoId === producto.id ? { ...item, cantidad: item.cantidad + incremento } : item,
        )
      : [
          ...carritoActivo.items,
          {
            productoId: producto.id,
            nombre: producto.nombre,
            cantidad: incremento,
            precioUnitario: producto.precioVenta,
          },
        ];

    actualizarCarritoActivo({ items });

    const promosDelProducto = promocionesDeProducto(promociones, producto.id);
    if (promosDelProducto.length > 0) {
      setAvisoPromoIds((anteriores) => {
        const nuevos = promosDelProducto.map((promocion) => promocion.id).filter((id) => !anteriores.includes(id));
        return nuevos.length > 0 ? [...anteriores, ...nuevos] : anteriores;
      });
    }
  }

  function cambiarCantidad(productoId: string, delta: number) {
    const producto = productos.find((p) => p.id === productoId);
    const item = carritoActivo.items.find((i) => i.productoId === productoId);
    if (!item || !producto) return;

    if (item.cantidad + delta > producto.stockActual) {
      setError(`No hay más stock de ${producto.nombre}`);
      return;
    }

    const items =
      item.cantidad + delta <= 0
        ? carritoActivo.items.filter((i) => i.productoId !== productoId)
        : carritoActivo.items.map((i) =>
            i.productoId === productoId ? { ...i, cantidad: i.cantidad + delta } : i,
          );

    actualizarCarritoActivo({ items });
  }

  // Para productos por kg/litro: la cantidad se edita directa (no hay
  // un "−" natural que llegue a 0), así que sacar la fila es una acción
  // aparte (quitarProducto) en vez de decrementar hasta cero.
  function cambiarCantidadExacta(productoId: string, cantidad: number, subtotalExacto?: number) {
    const producto = productos.find((p) => p.id === productoId);
    if (!producto) return;

    if (cantidad > producto.stockActual) {
      setError(`Quedan ${producto.stockActual} ${ETIQUETA_UNIDAD[producto.unidad]} de ${producto.nombre}`);
      return;
    }

    const items = carritoActivo.items.map((item) =>
      item.productoId === productoId ? { ...item, cantidad, subtotal: subtotalExacto } : item,
    );
    actualizarCarritoActivo({ items });
  }

  function quitarProducto(productoId: string) {
    const items = carritoActivo.items.filter((item) => item.productoId !== productoId);
    actualizarCarritoActivo({ items });
  }

  // Enter (o el lector, que manda Enter solo) intenta un match EXACTO
  // de código y agrega directo, como el viejo cuadro de "escanear". Si
  // lo tipeado no matchea ningún código, la reacción depende de si
  // "parece" un código escaneado (todo dígitos, varios caracteres) o
  // un nombre: lo primero es un error real (se escaneó algo que no
  // está en el catálogo) y hay que avisarlo; lo segundo es alguien
  // buscando por nombre y apretando Enter por costumbre — no hay
  // error, la grilla de abajo ya está filtrando en vivo y ahí se hace
  // click.
  function alEnviarBusqueda(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const termino = busqueda.trim();
    if (!termino) return;

    const producto = productos.find((p) => p.activo && coincideCodigoExacto(p, termino));
    if (!producto) {
      if (pareceCodigoDeBarras(termino)) setError("No hay ningún producto con ese código");
      return;
    }

    setError(null);
    agregarProducto(producto);
    setBusqueda("");
  }

  const productosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return productos
      .filter(
        (producto) =>
          producto.activo &&
          (!termino || coincideBusqueda(producto.nombre, busqueda) || contieneCodigo(producto, termino)),
      )
      .slice(0, 12);
  }, [productos, busqueda]);

  async function confirmarVenta() {
    setError(null);

    if (carritoActivo.items.length === 0) {
      setError("Todavía no cargaste ningún producto");
      return;
    }

    let pagos: PagoCarrito[] = [];

    if (carritoActivo.medioPago === "efectivo") {
      const pagaCon = carritoActivo.pagaCon ? Number(carritoActivo.pagaCon) : total;
      if (!Number.isFinite(pagaCon) || pagaCon < total) {
        setError("Con ese monto no alcanza para cubrir el total");
        return;
      }
      pagos = [{ medio: "efectivo", monto: pagaCon, vuelto: calcularVuelto(pagaCon, total) }];
    } else if (carritoActivo.medioPago === "mixto") {
      const efectivo = Number(carritoActivo.montoMixtoEfectivo) || 0;
      if (efectivo <= 0 || efectivo >= total) {
        setError("En pago mixto, la parte en efectivo tiene que ser mayor a cero y menor al total");
        return;
      }
      // recargoMonto ya sale calculado solo sobre esta parte (ver
      // montoBaseRecargo más arriba) cuando el resto es débito/crédito;
      // 0 si es transferencia, igual que siempre.
      pagos = [
        { medio: "efectivo", monto: efectivo, vuelto: 0 },
        { medio: carritoActivo.medioMixtoResto, monto: total - efectivo + recargoMonto, vuelto: 0 },
      ];
    } else if (carritoActivo.medioPago === "fiado") {
      if (!carritoActivo.clienteId) {
        setError("Para fiar tenés que elegir a qué cliente");
        return;
      }
      if (carritoActivo.clienteId === CLIENTE_NUEVO && !carritoActivo.nombreClienteNuevo.trim()) {
        setError("Escribí el nombre del cliente");
        return;
      }
      // No siempre se fía el total: "¿Cobrás algo ahora?" es opcional,
      // en el medio que se elija — lo que no se cobra ahí va fiado.
      // Vacío o 0 es exactamente el comportamiento de siempre (todo
      // fiado). Si esa parte es débito/crédito, el recargo (si hay) se
      // suma solo a lo que se cobra ahora — lo fiado queda igual.
      const montoRecibido = Number(carritoActivo.montoRecibidoFiado) || 0;
      if (montoRecibido < 0) {
        setError("El monto recibido no puede ser negativo");
        return;
      }
      if (montoRecibido >= total) {
        setError("Si cobrás todo, elegí ese medio directamente en vez de Fiado");
        return;
      }
      pagos =
        montoRecibido > 0
          ? [
              { medio: carritoActivo.medioRecibidoFiado, monto: montoRecibido + recargoMonto, vuelto: 0 },
              { medio: "fiado", monto: total - montoRecibido, vuelto: 0 },
            ]
          : [{ medio: "fiado", monto: total, vuelto: 0 }];
    } else if (esTarjeta) {
      pagos = [{ medio: carritoActivo.medioPago, monto: totalConRecargo, vuelto: 0 }];
    } else {
      pagos = [{ medio: carritoActivo.medioPago, monto: total, vuelto: 0 }];
    }

    if (!pagosCubrenElTotal(pagos, totalConRecargo)) {
      setError("Los pagos cargados no cubren el total de la venta");
      return;
    }

    setGuardando(true);
    const supabase = crearClienteNavegador();

    // Fiar a un cliente recién decidido en el momento: se crea acá,
    // como parte del mismo gesto de cobrar, en vez de mandar al
    // cajero a /clientes a mitad de una venta.
    let clienteId: string | null = null;
    if (carritoActivo.medioPago === "fiado") {
      if (carritoActivo.clienteId === CLIENTE_NUEVO) {
        const { data: nuevoCliente, error: errorCliente } = await supabase
          .from("clientes")
          .insert({ nombre: carritoActivo.nombreClienteNuevo.trim() })
          .select("id, nombre, telefono, direccion, saldo_cuenta_corriente")
          .single();

        if (errorCliente || !nuevoCliente) {
          setError("No se pudo crear el cliente. Probá de nuevo.");
          setGuardando(false);
          return;
        }

        clienteId = nuevoCliente.id;
        setListaClientes((anteriores) =>
          [
            ...anteriores,
            {
              id: nuevoCliente.id,
              nombre: nuevoCliente.nombre,
              telefono: nuevoCliente.telefono,
              direccion: nuevoCliente.direccion,
              saldoCuentaCorriente: Number(nuevoCliente.saldo_cuenta_corriente),
            },
          ].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        );
      } else {
        clienteId = carritoActivo.clienteId;
      }
    }

    const { data: filasVenta, error: errorRpc } = await supabase.rpc("registrar_venta", {
      p_turno_caja_id: turnoCajaId,
      p_cliente_id: clienteId,
      p_items: itemsConPromo.map((item) => ({
        producto_id: item.productoId,
        cantidad: item.cantidad,
        precio_unitario: item.precioUnitario,
        subtotal: calcularSubtotalItem(item),
      })),
      p_pagos: pagos,
      p_recargo_monto: recargoMonto,
    });
    setGuardando(false);

    if (errorRpc || !filasVenta?.[0]) {
      setError(errorRpc?.message ?? "No se pudo registrar la venta. Probá de nuevo.");
      return;
    }

    const medioTexto: Record<MedioPagoUi, string> = {
      efectivo: "Efectivo",
      transferencia: "Transferencia",
      debito: "Débito",
      credito: "Crédito",
      mixto: "Mixto",
      fiado: "Fiado",
    };
    // Fiado parcial: "Fiado" a secas en el ticket confundiría (parece
    // que se fio todo). "<Medio real> + Fiado" + la línea de "Queda
    // fiado" de más abajo dejan claro que se cobró una parte y en qué.
    const esFiadoParcial = carritoActivo.medioPago === "fiado" && pagos.length > 1;
    setComprobante({
      items: itemsConPromo,
      subtotal: total,
      total: totalConRecargo,
      medioTexto: esFiadoParcial
        ? `${medioTexto[carritoActivo.medioRecibidoFiado]} + Fiado`
        : medioTexto[carritoActivo.medioPago],
      vuelto: pagos.reduce((suma, pago) => suma + pago.vuelto, 0),
      saldoFiado: pagos.find((pago) => pago.medio === "fiado" && pago.monto < total)?.monto,
      recargoPorcentaje: recargoMonto > 0 ? Number(carritoActivo.porcentajeRecargoTarjeta) || 0 : undefined,
    });

    // Antes esto era un router.refresh(): recargaba toda /ventas para
    // que "Ventas de este turno" mostrara la nueva fila — de paso
    // volvía a traer el catálogo completo (~2991 productos) por cada
    // venta, la acción más frecuente del sistema. registrar_venta()
    // ahora devuelve numero/creado_en, así que se puede armar la fila
    // acá mismo y avisarle al padre (SeccionVentas) sin ir de nuevo a
    // la base.
    //
    // El texto del medio se arma desde `pagos` (lo que efectivamente
    // se guardó como ventas_pagos), no desde el selector de la UI: en
    // "mixto" son dos filas reales (por ejemplo efectivo+transferencia)
    // y así es como listarVentasDelTurno las muestra — si acá pusiera
    // "Mixto" a secas, la fila se vería distinta apenas hubiera un
    // refetch real más adelante.
    const filaVenta = filasVenta[0];
    const etiquetaMedioReal: Record<string, string> = {
      efectivo: "Efectivo",
      transferencia: "Transferencia",
      debito: "Débito",
      credito: "Crédito",
      fiado: "Fiado",
    };
    // Con más de un pago (mixta, o fiado parcial), cuánto fue de cada
    // medio — pedido explícito del cliente, 2026-08-24, mismo criterio
    // que medioTexto() en consultas/ventas.ts (que arma esto mismo para
    // las filas que vienen de listarVentasDelTurno): si acá solo
    // pusiera las etiquetas, la fila recién confirmada se vería distinta
    // del resto hasta el próximo refetch real.
    const medioTextoReal =
      pagos.length <= 1
        ? pagos.map((pago) => etiquetaMedioReal[pago.medio] ?? pago.medio).join(" + ")
        : pagos
            .map((pago) => `${etiquetaMedioReal[pago.medio] ?? pago.medio} ${platita.format(pago.monto - pago.vuelto)}`)
            .join(" + ");
    const nombreClienteFiado =
      carritoActivo.medioPago === "fiado"
        ? listaClientes.find((c) => c.id === clienteId)?.nombre ?? (carritoActivo.nombreClienteNuevo.trim() || null)
        : null;

    onVentaConfirmada(
      {
        id: filaVenta.id,
        numero: filaVenta.numero,
        turnoCajaId,
        clienteId,
        usuarioId,
        subtotal: total,
        total: totalConRecargo,
        estado: "confirmada",
        creadoEn: filaVenta.creado_en,
        medioTexto: medioTextoReal,
        clienteNombre: nombreClienteFiado,
      },
      carritoActivo.items.map((item) => ({ productoId: item.productoId, cantidad: item.cantidad })),
    );

    cerrarVenta(carritoActivo.id);
  }

  const vuelto =
    carritoActivo.medioPago === "efectivo" && carritoActivo.pagaCon
      ? calcularVuelto(Number(carritoActivo.pagaCon), total)
      : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {carritos.map((carrito, indice) => (
          <div
            key={carrito.id}
            className={`flex items-center gap-1.5 rounded-[var(--radius-base)] border px-2.5 py-1.5 text-sm ${
              carrito.id === carritoActivoId
                ? "border-marco bg-marco text-white"
                : "border-linea bg-superficie text-texto-suave hover:text-texto"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setCarritoActivoId(carrito.id);
                setAvisoPromoIds([]);
              }}
            >
              Venta {indice + 1}
              {carrito.items.length > 0 && ` (${carrito.items.length})`}
            </button>
            {carritos.length > 1 && (
              <button
                type="button"
                aria-label={`Cerrar venta ${indice + 1}`}
                onClick={() => cerrarVenta(carrito.id)}
                className="opacity-70 hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <Boton type="button" variante="fantasma" className="px-2.5 py-1.5 text-sm" onClick={nuevaVenta}>
          + Nueva venta
        </Boton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          {/* Un solo campo para escanear y para buscar por nombre —
              antes eran dos cajas apiladas (pedido del dueño: unificarlas).
              Escanear o tipear un código exacto + Enter agrega directo;
              tipear un nombre filtra la grilla de abajo en vivo, sin
              tocar Enter. */}
          <form onSubmit={alEnviarBusqueda} className="rounded-[var(--radius-base)] bg-marco p-4">
            <div className="flex gap-2">
              <input
                ref={inputBusquedaRef}
                autoFocus
                autoComplete="off"
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                onKeyDown={(evento) => {
                  // Pedido de Enzo (2026-09-11): al escanear, el Enter ya
                  // deja el campo listo para el próximo código
                  // (alEnviarBusqueda hace setBusqueda("")) — tipeando a
                  // mano no hay un gesto así. Flecha abajo selecciona todo
                  // lo tipeado para poder escribir el siguiente producto
                  // encima, sin ir a buscar el cursor o borrar a mano.
                  if (evento.key === "ArrowDown") {
                    evento.preventDefault();
                    evento.currentTarget.select();
                  }
                }}
                placeholder="Escaneá, buscá por nombre o código..."
                className="flex-1 rounded-[var(--radius-base)] border border-white/20 bg-marco-suave px-3 py-3 text-base text-white placeholder:text-white/40 outline-none"
              />
              <Boton type="submit">Agregar</Boton>
            </div>
          </form>

          {avisosPromo.length > 0 && (
            // bg-ok (no --acento): ese token está reservado para
            // totales/pantalla al cliente/CTA principal (ver tema.css) —
            // este aviso reusa el mismo verde que ya significa "buena
            // noticia de promo" en el badge de la línea del carrito y en
            // "Ahorrás $X" (mismo criterio, más fuerte por ser un aviso
            // nuevo que pide más atención).
            <div className="flex flex-col gap-2">
              {avisosPromo.map(({ promocion, descripcion, faltantes }) => (
                <div
                  key={promocion.id}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-base)] bg-ok px-4 py-3 text-base font-semibold text-white"
                >
                  <span>🏷️ {descripcion}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Pedido de Jason, 2026-09-11: agregar de un toque
                        lo que le falta a la promo. No se muestra si ya
                        está completa (nada que agregar) — el aviso queda
                        como confirmación de que la promo va a aplicar. */}
                    {faltantes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => completarPromocion(promocion)}
                        className="rounded-[var(--radius-base)] bg-white px-3 py-1.5 text-sm font-semibold text-ok hover:brightness-95"
                      >
                        Agregar a la venta
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Cerrar aviso de promoción"
                      onClick={() => setAvisoPromoIds((anteriores) => anteriores.filter((id) => id !== promocion.id))}
                      className="text-white/70 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {productosFiltrados.length === 0 ? (
              <p className="col-span-full py-8 text-center text-sm text-texto-suave">
                No hay productos con ese nombre.
              </p>
            ) : (
              productosFiltrados.map((producto) => {
                const sinStock = producto.stockActual <= 0;
                return (
                  <button
                    key={producto.id}
                    type="button"
                    disabled={sinStock}
                    onClick={() => agregarProducto(producto)}
                    className="rounded-[var(--radius-base)] border border-linea bg-superficie p-3 text-left transition hover:border-marco disabled:cursor-not-allowed"
                  >
                    {/* Antes toda la tarjeta se atenuaba con opacity-40
                        cuando no había stock, y el nombre quedaba difícil
                        de leer — pedido del cliente: el aviso ya está en
                        "sin stock", no hace falta además tapar el texto. */}
                    <p className="text-sm font-semibold text-texto">{producto.nombre}</p>
                    <p className="numero mt-1.5 text-sm font-semibold text-texto">
                      {platita.format(producto.precioVenta)}
                    </p>
                    <p className={`numero mt-0.5 text-xs ${sinStock ? "font-semibold text-alerta" : "text-texto-suave"}`}>
                      {sinStock ? "sin stock" : `${producto.stockActual} en góndola`}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Pedido de Jason (2026-09-17): con max-h-[60vh] de arriba, la
            tarjeta de "Venta en curso" empujaba "Cómo paga" demasiado
            abajo — se compacta el padding vertical de header/total y
            de cada fila (FilaCarritoItem.tsx) sin tocar ningún tamaño
            de letra, para que entren más filas en menos alto. */}
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-[var(--radius-base)] border border-linea bg-superficie">
            <div className="flex items-center justify-between border-b border-linea px-4 py-2">
              <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-texto">
                Venta en curso
              </h3>
              {carritoActivo.items.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-texto-suave underline"
                  onClick={() => {
                    actualizarCarritoActivo({ items: [] });
                    setAvisoPromoIds([]);
                  }}
                >
                  Vaciar
                </button>
              )}
            </div>
            {/* Pedido de Jason (2026-09-17): que se vean más productos
                cargados sin scrollear — antes max-h-72 (288px, ~5
                filas), ahora relativo a la pantalla en vez de un valor
                fijo chico. */}
            <div ref={listaCarritoRef} className="max-h-[60vh] overflow-y-auto">
              {carritoActivo.items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-texto-suave">
                  Escaneá el primer producto para empezar.
                </p>
              ) : (
                itemsConPromo.map((item) => (
                  <FilaCarritoItem
                    key={item.productoId}
                    item={item}
                    producto={productos.find((producto) => producto.id === item.productoId)}
                    onCambiarPaso={(delta) => cambiarCantidad(item.productoId, delta)}
                    onCambiarCantidadExacta={(cantidad, subtotalExacto) =>
                      cambiarCantidadExacta(item.productoId, cantidad, subtotalExacto)
                    }
                    onQuitar={() => quitarProducto(item.productoId)}
                  />
                ))
              )}
            </div>
            {ahorroPromociones > 0 && (
              <p className="flex items-center justify-between bg-ok-fondo px-4 py-1.5 text-xs font-semibold text-ok">
                <span>🏷️ Ahorrás con esta compra</span>
                <span className="numero">{platita.format(ahorroPromociones)}</span>
              </p>
            )}
            <div className="flex items-baseline justify-between bg-marco px-4 py-2">
              <span className="font-[family-name:var(--font-numero)] text-xs tracking-wider text-white/60">
                TOTAL
              </span>
              <span className="numero text-2xl font-semibold text-acento">{platita.format(total)}</span>
            </div>
          </div>

          <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-texto-suave">Cómo paga</p>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["efectivo", "Efectivo"],
                  ["transferencia", "Transferencia"],
                  ["debito", "Débito"],
                  ["credito", "Crédito"],
                  ["mixto", "Mixto"],
                  ["fiado", "Fiado"],
                ] as [MedioPagoUi, string][]
              ).map(([medio, etiqueta]) => (
                <button
                  key={medio}
                  type="button"
                  onClick={() => actualizarCarritoActivo({ medioPago: medio })}
                  className={`rounded-[var(--radius-base)] border px-2 py-2 text-xs font-semibold ${
                    carritoActivo.medioPago === medio
                      ? "border-marco bg-marco text-white"
                      : "border-linea bg-superficie text-texto hover:border-marco"
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {carritoActivo.medioPago === "efectivo" && (
                <>
                  <label htmlFor="pagaCon" className="mb-1 block text-xs text-texto-suave">
                    ¿Con cuánto paga?
                  </label>
                  <input
                    id="pagaCon"
                    type="number"
                    min={0}
                    step="1"
                    placeholder={String(total)}
                    value={carritoActivo.pagaCon}
                    onChange={(evento) => actualizarCarritoActivo({ pagaCon: evento.target.value })}
                    onFocus={(evento) => evento.currentTarget.select()}
                    className={`${clasesFiltro} numero w-full`}
                  />
                  {carritoActivo.pagaCon && vuelto >= 0 && Number(carritoActivo.pagaCon) >= total && (
                    <div className="mt-2 flex items-center justify-between rounded-[var(--radius-base)] bg-ok-fondo px-3 py-2">
                      <span className="text-xs font-semibold text-ok">Vuelto</span>
                      <span className="numero text-sm font-semibold text-ok">{platita.format(vuelto)}</span>
                    </div>
                  )}
                </>
              )}

              {carritoActivo.medioPago === "mixto" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="montoMixto" className="text-xs text-texto-suave">
                      Monto en efectivo (el resto va por el medio de al lado)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="montoMixto"
                        type="number"
                        min={0}
                        step="1"
                        value={carritoActivo.montoMixtoEfectivo}
                        onChange={(evento) => actualizarCarritoActivo({ montoMixtoEfectivo: evento.target.value })}
                        onFocus={(evento) => evento.currentTarget.select()}
                        className={`${clasesFiltro} numero min-w-0 flex-1`}
                      />
                      <select
                        aria-label="Medio en que se cobra el resto"
                        className={`${clasesSelect} w-36 shrink-0 py-1.5 text-sm`}
                        value={carritoActivo.medioMixtoResto}
                        onChange={(evento) =>
                          actualizarCarritoActivo({
                            medioMixtoResto: evento.target.value as CarritoEnCurso["medioMixtoResto"],
                          })
                        }
                      >
                        <option value="transferencia">Transferencia</option>
                        <option value="debito">Débito</option>
                        <option value="credito">Crédito</option>
                      </select>
                    </div>
                  </div>

                  {esMixtoConTarjeta && (
                    <CampoRecargoTarjeta
                      porcentaje={carritoActivo.porcentajeRecargoTarjeta}
                      onCambiar={(valor) => actualizarCarritoActivo({ porcentajeRecargoTarjeta: valor })}
                      montoConRecargo={totalConRecargo}
                    />
                  )}
                </div>
              )}

              {esTarjeta && (
                <CampoRecargoTarjeta
                  porcentaje={carritoActivo.porcentajeRecargoTarjeta}
                  onCambiar={(valor) => actualizarCarritoActivo({ porcentajeRecargoTarjeta: valor })}
                  montoConRecargo={totalConRecargo}
                />
              )}

              {carritoActivo.medioPago === "fiado" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="clienteFiado" className="text-xs text-texto-suave">
                      ¿A quién se le fía?
                    </label>
                    <select
                      id="clienteFiado"
                      className={clasesSelect}
                      value={carritoActivo.clienteId}
                      onChange={(evento) => actualizarCarritoActivo({ clienteId: evento.target.value })}
                    >
                      <option value="">Elegir cliente</option>
                      {listaClientes.map((cliente) => (
                        <option key={cliente.id} value={cliente.id}>
                          {cliente.nombre}
                          {cliente.saldoCuentaCorriente > 0
                            ? ` — debe ${platita.format(cliente.saldoCuentaCorriente)}`
                            : ""}
                        </option>
                      ))}
                      <option value={CLIENTE_NUEVO}>+ Nuevo cliente…</option>
                    </select>
                  </div>

                  {carritoActivo.clienteId === CLIENTE_NUEVO && (
                    <Campo
                      etiqueta="Nombre del cliente nuevo"
                      id="nombreClienteNuevo"
                      value={carritoActivo.nombreClienteNuevo}
                      onChange={(evento) =>
                        actualizarCarritoActivo({ nombreClienteNuevo: evento.target.value })
                      }
                    />
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="montoRecibidoFiado" className="text-xs text-texto-suave">
                      ¿Cobrás algo ahora? (opcional — el resto queda fiado)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="montoRecibidoFiado"
                        type="number"
                        min={0}
                        step="1"
                        placeholder="Vacío = fía todo"
                        value={carritoActivo.montoRecibidoFiado}
                        onChange={(evento) => actualizarCarritoActivo({ montoRecibidoFiado: evento.target.value })}
                        onFocus={(evento) => evento.currentTarget.select()}
                        className={`${clasesFiltro} numero min-w-0 flex-1`}
                      />
                      <select
                        aria-label="Medio en que se cobra ahora"
                        className={`${clasesSelect} w-32 shrink-0 py-1.5 text-sm`}
                        value={carritoActivo.medioRecibidoFiado}
                        onChange={(evento) =>
                          actualizarCarritoActivo({
                            medioRecibidoFiado: evento.target.value as Exclude<MedioPago, "fiado">,
                          })
                        }
                      >
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="debito">Débito</option>
                        <option value="credito">Crédito</option>
                      </select>
                    </div>

                    {esFiadoConTarjeta && (
                      <CampoRecargoTarjeta
                        porcentaje={carritoActivo.porcentajeRecargoTarjeta}
                        onCambiar={(valor) => actualizarCarritoActivo({ porcentajeRecargoTarjeta: valor })}
                        montoConRecargo={totalConRecargo}
                      />
                    )}

                    {Number(carritoActivo.montoRecibidoFiado) > 0 &&
                      Number(carritoActivo.montoRecibidoFiado) < total && (
                        <div className="flex items-center justify-between rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2">
                          <span className="text-xs font-semibold text-alerta">Queda fiado</span>
                          <span className="numero text-sm font-semibold text-alerta">
                            {platita.format(total - Number(carritoActivo.montoRecibidoFiado))}
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <p className="mt-3 rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">
                {error}
              </p>
            )}

            <Boton
              type="button"
              variante="confirmar"
              className="mt-3 w-full"
              disabled={carritoActivo.items.length === 0 || guardando}
              onClick={confirmarVenta}
            >
              {guardando
                ? "Cobrando…"
                : carritoActivo.medioPago === "fiado" && Number(carritoActivo.montoRecibidoFiado) > 0
                  ? `Cobrar ${platita.format((Number(carritoActivo.montoRecibidoFiado) || 0) + recargoMonto)} y fiar el resto`
                  : `Cobrar ${platita.format(totalConRecargo)}`}
            </Boton>
          </div>
        </div>
      </div>

      <Modal titulo="Venta registrada" abierto={comprobante !== null} onCerrar={() => setComprobante(null)}>
        {comprobante && (
          <div className="flex flex-col gap-3">
            <TicketVenta
              items={comprobante.items}
              total={comprobante.total}
              medioTexto={comprobante.medioTexto}
              vuelto={comprobante.vuelto}
              saldoFiado={comprobante.saldoFiado}
              subtotal={comprobante.subtotal}
              recargoPorcentaje={comprobante.recargoPorcentaje}
            />
            <AccionesTicket />
            <Boton type="button" variante="confirmar" onClick={() => setComprobante(null)}>
              Seguir vendiendo
            </Boton>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Compartido entre "Débito/Crédito" puro y "Mixto con débito/crédito"
// (2026-09-10): el mismo campo de % de recargo y la misma vista previa
// de "Total con recargo", solo cambia qué parte del total representa
// ese monto (todo, o solo la parte de tarjeta — ya resuelto por quien
// llama, en `montoConRecargo`).
function CampoRecargoTarjeta({
  porcentaje,
  onCambiar,
  montoConRecargo,
}: {
  porcentaje: string;
  onCambiar: (valor: string) => void;
  montoConRecargo: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="porcentajeRecargoTarjeta" className="text-xs text-texto-suave">
        % de recargo (opcional, según la tarjeta/cuotas)
      </label>
      <input
        id="porcentajeRecargoTarjeta"
        type="number"
        min={0}
        step="1"
        placeholder="0"
        value={porcentaje}
        onChange={(evento) => onCambiar(evento.target.value)}
        onFocus={(evento) => evento.currentTarget.select()}
        className={`${clasesFiltro} numero w-full`}
      />
      {Number(porcentaje) > 0 && (
        <div className="flex items-center justify-between rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2">
          <span className="text-xs font-semibold text-alerta">Total con recargo</span>
          <span className="numero text-sm font-semibold text-alerta">{platita.format(montoConRecargo)}</span>
        </div>
      )}
    </div>
  );
}

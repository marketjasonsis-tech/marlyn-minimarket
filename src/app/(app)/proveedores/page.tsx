import { BarraSuperior } from "@/componentes/BarraSuperior";
import { EstadoVacio } from "@/componentes/EstadoVacio";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { listarProveedores } from "@/modulos/proveedores/consultas/proveedores";
import { listarProductos } from "@/modulos/stock/consultas/productos";
import { FormularioNuevoProveedor } from "@/modulos/proveedores/componentes/FormularioNuevoProveedor";
import { ListaProveedores } from "@/modulos/proveedores/componentes/ListaProveedores";
import { PanelNoComprar } from "@/modulos/proveedores/componentes/PanelNoComprar";

export default async function PaginaProveedores() {
  const supabase = await crearClienteServidor();
  const [proveedores, productos] = await Promise.all([listarProveedores(supabase), listarProductos(supabase)]);

  return (
    <>
      <BarraSuperior titulo="Proveedores">
        <FormularioNuevoProveedor />
      </BarraSuperior>
      <main className="flex-1 p-4 md:p-6">
        {proveedores.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no cargaste ningún proveedor"
            descripcion="Sumá uno acá o al vuelo desde Stock al cargar un producto."
          />
        ) : (
          <ListaProveedores proveedores={proveedores} productos={productos} />
        )}
        <PanelNoComprar productos={productos} proveedores={proveedores} />
      </main>
    </>
  );
}

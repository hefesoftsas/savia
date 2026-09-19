/* Savia's UNO bridge. Runs inside the office worker. */
"use strict";
Module.zetajs
  .then(function (zeta) {
    const css = zeta.uno.com.sun.star;
    const desktop = css.frame.Desktop.create(zeta.getUnoComponentContext());
    let model, listener, path, interceptor;
    const port = zeta.mainPort;
    const property = (Name, Value) =>
      new css.beans.PropertyValue({ Name, Value });
    port.onmessage = function ({ data }) {
      try {
        if (data.cmd === "open") {
          if (model) throw new Error("Abre cada archivo en su propia ventana.");
          if (!/^document\.(docx|xlsx|pptx)$/.test(data.filename))
            throw new Error("Nombre de documento inválido.");
          path = "file:///tmp/savia-office/" + data.filename;
          model = desktop.loadComponentFromURL(path, "_default", 0, [
            property("MacroExecutionMode", new zeta.Any(zeta.type.short, 0)),
            property("UpdateDocMode", new zeta.Any(zeta.type.short, 0)),
          ]);
          if (!model) throw new Error("No se pudo abrir el documento.");
          model
            .getCurrentController()
            .getFrame()
            .getContainerWindow().FullScreen = true;
          listener = zeta.unoObject([css.util.XModifyListener], {
            disposing: function () {},
            modified: function () {
              if (model.isModified()) port.postMessage({ cmd: "dirty" });
            },
          });
          model.addModifyListener(listener);
          // Route native Save through Savia too; prevent replacing this tab's model.
          let master = null,
            slave = null;
          const blocked = new Set([
            ".uno:SaveAs",
            ".uno:SaveACopy",
            ".uno:Open",
            ".uno:NewDoc",
            ".uno:CloseDoc",
            ".uno:CloseWin",
            ".uno:Quit",
          ]);
          const saver = zeta.unoObject([css.frame.XDispatch], {
            dispatch: function () {
              port.postMessage({ cmd: "save-request" });
            },
            addStatusListener: function (status, url) {
              status.statusChanged(
                new css.frame.FeatureStateEvent({
                  Source: saver,
                  FeatureURL: url,
                  IsEnabled: true,
                  Requery: false,
                }),
              );
            },
            removeStatusListener: function () {},
          });
          function query(url, target, flags) {
            if (url.Complete === ".uno:Save") return saver;
            if (blocked.has(url.Complete) || url.Protocol === "private:")
              return null;
            return slave ? slave.queryDispatch(url, target, flags) : null;
          }
          interceptor = zeta.unoObject(
            [css.frame.XDispatchProviderInterceptor],
            {
              queryDispatch: query,
              queryDispatches: function (queries) {
                return queries.map((q) =>
                  query(q.FeatureURL, q.FrameName, q.SearchFlags),
                );
              },
              getMasterDispatchProvider: function () {
                return master;
              },
              setMasterDispatchProvider: function (value) {
                master = value;
              },
              getSlaveDispatchProvider: function () {
                return slave;
              },
              setSlaveDispatchProvider: function (value) {
                slave = value;
              },
            },
          );
          model
            .getCurrentController()
            .getFrame()
            .registerDispatchProviderInterceptor(interceptor);
          port.postMessage({ cmd: "opened", id: data.id });
        } else if (data.cmd === "save") {
          if (!model) throw new Error("El documento no está abierto.");
          if (model.getURL() !== path)
            throw new Error(
              "El documento cambió de ubicación. Vuelve a abrirlo desde Savia.",
            );
          model.store();
          port.postMessage({ cmd: "saved", id: data.id });
        }
      } catch (error) {
        port.postMessage({
          cmd: "error",
          id: data.id,
          message:
            "No se pudo procesar el documento. " + String(error).slice(0, 160),
        });
      }
    };
    port.postMessage({ cmd: "ready" });
  })
  .catch(function (error) {
    console.error("Office initialization failed", error);
  });

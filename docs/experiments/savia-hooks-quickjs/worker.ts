import { execute } from "./quickjs";
export default {
  async fetch(request) {
    const { code, payload, repeat = 1, options } = await request.json();
    try {
      let result;
      for (let i = 0; i < repeat; i++)
        result = await execute(code, payload, options);
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, error: error.message });
    }
  },
};

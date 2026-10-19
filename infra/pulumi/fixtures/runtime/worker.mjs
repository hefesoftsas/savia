// Synthetic code used only by the isolated lifecycle fixture.
export class FixtureStore {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    if (request.method === "PUT") {
      await this.state.storage.put("value", await request.text());
    }
    return Response.json({ value: await this.state.storage.get("value") });
  }
}

export default {
  fetch() {
    return new Response("Isolated lifecycle fixture", { status: 503 });
  },
};

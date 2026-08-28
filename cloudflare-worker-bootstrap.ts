const bootstrapWorker = {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
};

export default bootstrapWorker;

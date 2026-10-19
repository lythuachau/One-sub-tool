const consumeSseJsonStream = async (response, onEvent) => {
  if (!response.body) throw new Error('The server returned an empty progress stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = eventBlock => {
    const data = eventBlock
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;

    try {
      onEvent(JSON.parse(data));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid progress event from server: ${error.message}`);
      throw error;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer = buffer.replace(/\r\n/g, '\n');
  if (buffer.trim()) dispatch(buffer);
};

export default consumeSseJsonStream;

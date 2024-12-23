## Client Setup

To serve the client application, follow these steps:

1. Navigate to the client directory:

    ```bash
    cd ./client
    ```

2. Build Docker image:

    ```bash
    docker build --build-arg VITE_API_URL=http://custom.api.url .
    ```

3. Or for Development purpose:

    ```
    npm run dev
    ```

---

## Server Setup

To run the server, execute the following steps:

1. Navigate to the server directory:

    ```bash
    cd server
    ```

2. Start the server:

    ```bash
    node server.js
    ```

Your server will now be running and ready to accept requests.

---

### Additional Information

-   Ensure you have Azurite + make sure tne server `.env` is filled properly.

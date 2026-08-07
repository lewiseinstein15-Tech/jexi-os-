# Use Ubuntu as the base image
FROM ubuntu:22.04

# Avoid timezone prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, Python, and all desktop/GUI tools
RUN apt-get update && apt-get install -y \
    curl wget git \
    nodejs npm \
    python3 python3-pip \
    xvfb openbox xterm \
    netsurf-gtk \
    ffmpeg tesseract-ocr \
    xdotool scrot \
    && rm -rf /var/lib/apt/lists/*

# Set up the working directory
WORKDIR /app

# Copy the JEXI OS backend and frontend code
COPY ./server ./server
COPY ./frontend ./frontend
COPY ./package.json ./package.json

# Install backend dependencies
WORKDIR /app/server
RUN npm install

# Build the frontend
WORKDIR /app/frontend
RUN npm install && npm run build

# Move the built frontend to be served by the backend
RUN mv ./dist ../server/public

# Expose the port JEXI OS runs on
EXPOSE 3002

# Start the virtual display and the JEXI OS backend
CMD bash -c "Xvfb :1 -screen 0 1280x720x24 & sleep 2 && export DISPLAY=:1 && openbox --sm-disable & cd /app/server && node index.js"

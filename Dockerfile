# Use Node.js 20
FROM node:20

# Working directory
WORKDIR /app

# Copy package files
COPY middleware/package*.json ./

# Install dependencies
RUN npm install

# Copy full middleware code
COPY middleware .

# Build project (TypeScript ho to)
RUN npm run build

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "run", "start"]
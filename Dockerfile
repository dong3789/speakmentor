FROM node:25-slim
WORKDIR /app

# 팟캐스트 생성용 ffmpeg (mp3 연결 + 재생시간 측정)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]

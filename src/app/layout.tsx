import "./globals.css";

export const metadata = {
  title: "SpeakMentor — 나만의 AI 영어 지도교사",
  description: "말하면 교정해주고, 틀린 문장은 복습 카드가 되는 영어 회화 튜터",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

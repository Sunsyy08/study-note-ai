export const metadata = {
  title: "학습노트 AI",
  description: "공부한 내용을 자동으로 정리해주는 서비스",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

import { Link } from 'react-router-dom'

function App() {
  return (
    <div className="container container-center">
      <h1 className="title">
        <img src="/logo-horizontal.png" alt="CELIAR GAME" className="logo-horizontal" />
      </h1>
      
      <div className="menu">
        <Link to="/player" className="btn btn-primary">
          参加者として入場
        </Link>
        <Link to="/admin" className="btn btn-secondary">
          管理者画面
        </Link>
        <Link to="/display" className="btn btn-gold">
          観客用ディスプレイ
        </Link>
      </div>
    </div>
  )
}

export default App

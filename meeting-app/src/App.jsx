import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import MeetingPage from './pages/MeetingPage';
import NotFoundPage from './pages/NotFoundPage';
import { MeetingProvider } from './context/MeetingContext';
import './index.css';

const App = () => {
    return (
        <Router>
            <MeetingProvider>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/meeting/:roomID" element={<MeetingPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </MeetingProvider>
        </Router>
    );
};

export default App;
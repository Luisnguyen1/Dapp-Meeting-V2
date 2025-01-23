import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMeetingContext } from "../context/MeetingContext";
import MeetingRoom from '../components/MeetingRoom/MeetingRoom';
import UserControls from '../components/UserControls/UserControls';
import UserList from '../components/UserList/UserList';
import './MeetingPage.css';

const MeetingPage = () => {
    const { meetingId, participants } = useMeetingContext();
    const navigate = useNavigate();
    const { id } = useParams();

    React.useEffect(() => {
        if (!meetingId && !id) {
            navigate('/');
        }
    }, [meetingId, id, navigate]);

    if (!meetingId && !id) {
        return null;
    }

    return (
        <div className="meeting-container">
            <MeetingRoom />
            <div className="controls-container">
                <UserControls />
            </div>
            <div className="user-list-container">
                <UserList users={participants} />
            </div>
        </div>
    );
};

export default MeetingPage;
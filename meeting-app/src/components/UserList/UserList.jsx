import React from 'react';
import './UserList.css';

const UserList = ({ users }) => {
    return (
        <div className="user-list">
            <h3>Participants</h3>
            <ul>
                {users.map(user => (
                    <li key={user.id}>
                        <span>{user.username}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default UserList;
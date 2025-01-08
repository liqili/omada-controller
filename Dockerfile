# Use an official Ubuntu as the base image
FROM ubuntu:18.04

# Set environment variables to avoid interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Define the base installation path as a variable
ENV INSTALL_DIR=/tmp/EAPController
ENV WORK_DIR=/opt/tplink/EAPController
# Install dependencies
RUN apt-get update && apt-get install -y \
    openjdk-11-jre-headless \
    curl \
    jsvc \
    wget \
    sudo \
    libcap2-bin \
    unzip \
    gnupg \
    lsb-release \
    build-essential \
    libapr1-dev \
    libssl-dev \
    && apt-get clean

RUN mkdir /usr/lib/jvm/java-11-openjdk-amd64/lib/amd64 && \
    ln -s /usr/lib/jvm/java-11-openjdk-amd64/lib/server /usr/lib/jvm/java-11-openjdk-amd64/lib/amd64/

# Install MongoDB 3.6.22 manually from the provided URL
RUN wget https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu1804-3.6.22.tgz -O /tmp/mongodb.tgz && \
    tar -xzvf /tmp/mongodb.tgz -C /opt && \
    mv /opt/mongodb-linux-x86_64-ubuntu1804-3.6.22 /opt/mongodb && \
    rm /tmp/mongodb.tgz && \
    ln -s /opt/mongodb/bin/mongod /usr/local/bin/mongod && \
    ln -s /opt/mongodb/bin/mongo /usr/local/bin/mongo

# Create required directories
RUN mkdir -p ${INSTALL_DIR}/data ${INSTALL_DIR}/bin

# Set the working directory
WORKDIR ${INSTALL_DIR}

# Copy the local Omada Controller files into the container
COPY . ${INSTALL_DIR}

# Make install.sh executable
RUN chmod +x ${INSTALL_DIR}/install.sh

# Run the installation script
RUN ${INSTALL_DIR}/install.sh -y

RUN mv healthcheck.sh ${WORK_DIR}/healthcheck.sh && chmod +x ${WORK_DIR}/healthcheck.sh

RUN rm -rf ${INSTALL_DIR}
# Expose the ports used by Omada Controller (default ports)
EXPOSE 8088 8043 8843 29810/udp 29811 29812 29813 29814

WORKDIR ${WORK_DIR}

HEALTHCHECK --start-period=5m CMD ./healthcheck.sh
# Command to start the Omada Controller service
# CMD ["tpeap", "start"]
CMD ["bash", "-c", "tpeap start && tail -f ${WORK_DIR}/logs/server.log"]